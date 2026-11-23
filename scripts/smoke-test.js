// Test de bout en bout de l'API, sur un serveur lancé en développement (SMS_PROVIDER=console).
// Usage : BASE=http://localhost:3000 npm test   (base fraîchement remplie par npm run db:seed)
const BASE = (process.env.BASE || "http://localhost:3000").replace(/\/$/, "") + "/api";
let failed = 0;

async function call(method, url, body, token) {
  const r = await fetch(BASE + url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = r.headers.get("content-type") || "";
  const data = type.includes("json") ? await r.json() : await r.text();
  if (Array.isArray(data)) { data.s = r.status; return data; }
  return typeof data === "string" ? { s: r.status, text: data } : { s: r.status, ...data };
}
function ok(name, cond, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "OK  " : "FAIL"} ${name}${extra ? "  (" + extra + ")" : ""}`);
}
async function clientLogin(phone, name) {
  const c = await call("POST", "/client/code", { phone });
  if (!c.devCode) throw new Error("Pas de devCode : lance le serveur avec SMS_PROVIDER=console hors production");
  return call("POST", "/client/verify", { phone, code: c.devCode, name });
}
const staff = (username, password = "707707") => call("POST", "/staff/login", { username, password });

(async () => {
  // ---- Menu et tables ----
  const menu = await call("GET", "/menu");
  ok("menu public", menu.products.length > 30 && menu.floors.length === 3);
  ok("QR d'une table existante", (await call("GET", "/qr.svg?floor=1&table=3")).s === 200);
  ok("QR d'une table hors terrasse refusé", (await call("GET", "/qr.svg?floor=1&table=40")).s === 404);

  // ---- Connexion client par code ----
  const r1 = await call("POST", "/client/code", { phone: "55123456" });
  ok("code envoyé, client nouveau", r1.sent && r1.isNew);
  ok("deuxième code trop tôt refusé", (await call("POST", "/client/code", { phone: "55123456" })).s === 429);
  ok("mauvais code refusé", (await call("POST", "/client/verify", { phone: "55123456", code: "000000", name: "Sami" })).s === 400);
  ok("nouveau client sans prénom refusé", (await call("POST", "/client/verify", { phone: "55123456", code: r1.devCode })).s === 400);
  const sami = await call("POST", "/client/verify", { phone: "55123456", code: r1.devCode, name: "Sami" });
  ok("client créé", !!sami.token && sami.client.name === "Sami");
  ok("code réutilisé refusé", (await call("POST", "/client/verify", { phone: "55123456", code: r1.devCode })).s === 400);

  // ---- Commandes et tables ----
  const T = sami.token;
  ok("commande sans connexion refusée", (await call("POST", "/orders", { floorId: 1, table: "3", payment: "Carte", lines: [{ productId: 1, qty: 1 }] })).s === 401);
  ok("table 99 refusée", (await call("POST", "/orders", { floorId: 1, table: "99", payment: "Carte", lines: [{ productId: 1, qty: 1 }] }, T)).s === 400);
  const o1 = await call("POST", "/orders", { floorId: 1, table: "5", payment: "Espèces",
    lines: [{ productId: 8, qty: 1, optionIds: ["thon"] }, { productId: 1, qty: 2 }] }, T);
  ok("commande mixte cuisine + bar", o1.orderId && o1.total === 22.8 && o1.pointsEarned === 21, `total=${o1.total}`);

  // ---- Payer avec ses points ----
  ok("plus de points que le solde refusé", (await call("POST", "/orders", { floorId: 1, table: "5", payment: "Carte",
    lines: [{ productId: 1, qty: 1 }], usePoints: 30 }, T)).s === 400);
  ok("points pas multiples de 10 refusés", (await call("POST", "/orders", { floorId: 1, table: "5", payment: "Carte",
    lines: [{ productId: 1, qty: 1 }], usePoints: 15 }, T)).s === 400);
  const o2 = await call("POST", "/orders", { floorId: 1, table: "5", payment: "Carte",
    lines: [{ productId: 3, qty: 1 }], usePoints: 20 }, T);
  ok("paiement avec 20 points", o2.discount === 2 && o2.total === 7 && o2.points === 21 - 20 + 7, `total=${o2.total} points=${o2.points}`);

  // ---- Cuisine / bar ----
  const cuisine = await staff("cuisine"), bar = await staff("bar");
  const kc = await call("GET", "/kitchen/orders", null, cuisine.token);
  ok("cuisine voit la pizza, pas les boissons", kc.orders.some(o => o.id === o1.orderId && o.items.every(i => i.name === "Pizza")));
  const kb = await call("GET", "/kitchen/orders", null, bar.token);
  ok("bar voit les Express", kb.orders.some(o => o.id === o1.orderId && o.items.every(i => i.name === "Express")));
  ok("cuisine n'a pas accès aux commandes serveur", (await call("GET", "/staff/orders", null, cuisine.token)).s === 403);
  const rc = await call("POST", `/kitchen/orders/${o1.orderId}/ready`, null, cuisine.token);
  ok("cuisine prête, commande pas encore prête", rc.orderReady === false);
  const rb = await call("POST", `/kitchen/orders/${o1.orderId}/ready`, null, bar.token);
  ok("bar prêt -> commande prête", rb.orderReady === true);

  // ---- Serveurs : chacun sa terrasse ----
  const s1 = await staff("serveur1"), s2 = await staff("serveur2");
  const l1 = await call("GET", "/staff/orders", null, s1.token);
  ok("serveur1 voit ses 2 commandes, marquée prête", l1.length === 2 && l1.find(o => o.id === o1.orderId).ready);
  ok("serveur2 ne voit rien", (await call("GET", "/staff/orders?floor=1", null, s2.token)).length === 0);
  ok("serveur2 ne touche pas la terrasse 1", (await call("PATCH", `/staff/orders/${o1.orderId}`, { status: "en_preparation" }, s2.token)).s === 404);

  // ---- Appels ----
  ok("appel sur table hors terrasse refusé", (await call("POST", "/client/calls", { floorId: 1, table: "20", kind: "serveur" }, T)).s === 400);
  const call1 = await call("POST", "/client/calls", { floorId: 1, table: "5", kind: "addition", payment: "Carte" }, T);
  ok("demande d'addition", call1.status === "ouvert");
  ok("serveur1 voit l'appel", (await call("GET", "/staff/calls", null, s1.token)).some(c => c.id === call1.id));
  ok("serveur2 ne voit pas l'appel", (await call("GET", "/staff/calls", null, s2.token)).length === 0);
  await call("PATCH", `/staff/calls/${call1.id}`, {}, s1.token);
  const live = await call("GET", "/client/live", null, T);
  ok("le client voit l'appel traité et sa commande prête",
    live.calls.some(c => c.id === call1.id && c.status === "traite") && live.orders.some(o => o.id === o1.orderId && o.ready));

  // ---- Encaissement ----
  for (const st of ["en_preparation", "servie"]) await call("PATCH", `/staff/orders/${o1.orderId}`, { status: st }, s1.token);
  const pay = await call("PATCH", `/staff/orders/${o1.orderId}`, { status: "payee", method: "Carte" }, s1.token);
  ok("encaissée par carte", pay.status === "payee");
  const mine = await call("GET", "/staff/cash/me", null, s1.token);
  ok("caisse du serveur", mine.carte === 22.8 && mine.especes === 0, JSON.stringify(mine));

  // ---- Annulation : points rendus ----
  const before = (await call("GET", "/client/me", null, T)).points;
  await call("PATCH", `/staff/orders/${o2.orderId}`, { status: "annulee" }, s1.token);
  const after = (await call("GET", "/client/me", null, T)).points;
  ok("annulation : 20 points rendus, 7 retirés", after === before + 20 - 7, `${before} -> ${after}`);

  // ---- Admin ----
  const a = await staff("admin", "admin707");
  const cat = await call("POST", "/admin/categories", { label: "Burgers", station: "cuisine" }, a.token);
  ok("catégorie créée", cat.key === "burgers");
  const prod = await call("POST", "/admin/products", { name: "Burger 707", price: 18.5, category: "burgers", icon: "🍔", note: "Bœuf, cheddar" }, a.token);
  ok("produit créé", prod.id >= 100);
  const grp = await call("POST", `/admin/products/${prod.id}/groups`, { title: "Cuisson", single: true }, a.token);
  const opt = await call("POST", `/admin/groups/${grp.id}/options`, { name: "Bien cuit", price: 0 }, a.token);
  await call("POST", `/admin/groups/${grp.id}/options`, { name: "Saignant", price: 0 }, a.token);
  ok("option créée", !!opt.id);
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const img = await call("POST", "/admin/images", { dataUrl: png }, a.token);
  await call("PATCH", `/admin/products/${prod.id}`, { imageId: img.id }, a.token);
  const menu2 = await call("GET", "/menu");
  const burger = menu2.products.find(p => p.id === prod.id);
  ok("nouveau produit visible au menu avec photo et options", burger && burger.image && burger.groups[0].items.length === 2);
  ok("photo servie", (await fetch(BASE.replace("/api", "") + burger.image)).status === 200);
  const ob = await call("POST", "/orders", { floorId: 2, table: "16", payment: "Carte", lines: [{ productId: prod.id, qty: 1, optionIds: [opt.id] }] }, T);
  ok("commande du nouveau produit", ob.total === 18.5);
  await call("PATCH", `/admin/products/${prod.id}`, { archived: true }, a.token);
  ok("produit retiré du menu", !(await call("GET", "/menu")).products.some(p => p.id === prod.id));

  ok("terrasse qui chevauche refusée", (await call("POST", "/admin/floors", { name: "Salle", tableFrom: 40, tableTo: 50 }, a.token)).s === 409);
  const fl = await call("POST", "/admin/floors", { name: "Salle", tableFrom: 46, tableTo: 60 }, a.token);
  ok("nouvelle terrasse", !!fl.id);
  ok("serveur cuisine créé", !!(await call("POST", "/admin/staff", { name: "Chef", username: "chef", password: "chef707", role: "cuisine" }, a.token)).id);

  const cash = await call("GET", "/admin/cash", null, a.token);
  ok("caisse du jour", cash.carte === 22.8 && cash.unpaid.n === 1, `carte=${cash.carte} non payées=${cash.unpaid.n}`);
  ok("clôture refusée tant qu'il reste une commande", (await call("POST", "/admin/cash/close", { day: cash.day }, a.token)).s === 409);
  const today = cash.day;
  const rep = await call("GET", `/admin/reports?from=${today}&to=${today}`, null, a.token);
  ok("rapport", rep.orders === 2 && rep.cancelled === 1 && rep.floors.length === 2, `orders=${rep.orders}`);
  const csv = await call("GET", `/admin/reports.csv?from=${today}&to=${today}`, null, a.token);
  ok("export CSV", csv.s === 200 && csv.text.split("\r\n").length === 4);
  ok("serveur sans accès admin", (await call("GET", "/admin/cash", null, s1.token)).s === 403);

  // ---- Café disponible / non disponible ----
  ok("un serveur ne peut pas fermer le café", (await call("PATCH", "/admin/status", { open: false }, s1.token)).s === 403);
  ok("fermeture par l'admin", (await call("PATCH", "/admin/status", { open: false }, a.token)).open === false);
  ok("le client voit le café fermé", (await call("GET", "/status")).open === false && (await call("GET", "/menu")).open === false);
  ok("commande refusée quand c'est fermé", (await call("POST", "/orders", { floorId: 1, table: "5", lines: [{ productId: 1, qty: 1 }] }, T)).s === 409);
  ok("appel serveur refusé quand c'est fermé", (await call("POST", "/client/calls", { floorId: 1, table: "6", kind: "serveur" }, T)).s === 409);
  await new Promise(r => setTimeout(r, 21000)); // anti-spam : un appel par client toutes les 20 s
  ok("l'addition reste possible", (await call("POST", "/client/calls", { floorId: 1, table: "6", kind: "addition" }, T)).status === "ouvert");
  ok("réouverture", (await call("PATCH", "/admin/status", { open: true }, a.token)).open === true);
  ok("commande acceptée après réouverture", !!(await call("POST", "/orders", { floorId: 1, table: "5", lines: [{ productId: 1, qty: 1 }] }, T)).orderId);

  // ---- Terrains de foot ----
  const chef = await staff("terrain");
  const field = await call("GET", "/pitches");
  ok("3 terrains", field.pitches.length === 3);
  const cal = await call("GET", "/pitches/1/calendar");
  ok("calendrier sur 30 jours", cal.days.length === 30);
  const slot = { pitchId: 1, day: cal.days[2].day, hour: 20 };
  const isFree = async () => (await call("GET", `/pitches/1/slots?day=${slot.day}`)).slots.find(x => x.hour === 20).state;
  ok("réservation sans connexion refusée", (await call("POST", "/client/reservations", slot)).s === 401);
  ok("date hors calendrier refusée", (await call("POST", "/client/reservations", { ...slot, day: "2020-01-01" }, T)).s === 400);
  ok("heure fermée refusée", (await call("POST", "/client/reservations", { ...slot, hour: 3 }, T)).s === 400);
  const rA = await call("POST", "/client/reservations", slot, T);
  ok("demande du client", rA.status === "en_attente");
  ok("même demande refusée", (await call("POST", "/client/reservations", slot, T)).s === 409);
  ok("créneau encore libre avant confirmation", (await isFree()) === "libre");
  const other = await clientLogin("55999888", "Karim");
  const rB = await call("POST", "/client/reservations", slot, other.token);
  ok("autre demande sur le même créneau", rB.status === "en_attente");
  ok("les créneaux publics ne montrent aucun numéro", !JSON.stringify(await call("GET", `/pitches/1/slots?day=${slot.day}`)).includes("55123456"));
  ok("serveur sans accès aux terrains", (await call("GET", "/terrain/board", null, s1.token)).s === 403);
  ok("client sans accès aux terrains", (await call("GET", "/terrain/board", null, T)).s === 401);
  const board = await call("GET", `/terrain/board?day=${slot.day}`, null, chef.token);
  ok("le chef voit le numéro", board.pending.some(r => r.id === rA.id && r.phone === "55123456"));
  ok("l'admin voit les demandes", (await call("GET", "/terrain/board", null, a.token)).pending.length === 2);
  const done = await call("PATCH", `/terrain/reservations/${rA.id}`, { status: "confirmee" }, chef.token);
  ok("le chef confirme le match", done.status === "confirmee" && done.autoRefused === 1);
  ok("créneau éteint après confirmation", (await isFree()) === "reserve");
  ok("l'autre demande est refusée", (await call("GET", "/client/reservations", null, other.token)).find(r => r.id === rB.id).status === "refusee");
  ok("nouvelle demande refusée sur créneau pris", (await call("POST", "/client/reservations", slot, other.token)).s === 409);
  ok("le client ne peut pas annuler son match", (await call("DELETE", `/client/reservations/${rA.id}`, null, T)).s === 404);
  ok("l'admin ne peut pas annuler un match", (await call("PATCH", `/terrain/reservations/${rA.id}`, { status: "annulee" }, a.token)).s === 403);
  ok("le match reste confirmé", (await isFree()) === "reserve");
  ok("double traitement refusé", (await call("PATCH", `/terrain/reservations/${rA.id}`, { status: "refusee" }, chef.token)).s === 409);
  ok("le chef annule le match", (await call("PATCH", `/terrain/reservations/${rA.id}`, { status: "annulee" }, chef.token)).status === "annulee");
  ok("créneau rallumé après annulation", (await isFree()) === "libre");
  ok("le client voit l'annulation du chef", (await call("GET", "/client/reservations", null, T)).find(r => r.id === rA.id).status === "annulee");

  // ---- Prix des terrains ----
  ok("un serveur ne fixe pas le prix", (await call("PATCH", "/admin/pitches/1", { price: 60 }, s1.token)).s === 403);
  ok("le chef ne fixe pas le prix", (await call("PATCH", "/admin/pitches/1", { price: 60 }, chef.token)).s === 403);
  ok("prix négatif refusé", (await call("PATCH", "/admin/pitches/1", { price: -5 }, a.token)).s === 400);
  ok("prix zéro refusé", (await call("PATCH", "/admin/pitches/1", { price: 0 }, a.token)).s === 400);
  ok("l'admin fixe le prix", (await call("PATCH", "/admin/pitches/1", { price: 60.5 }, a.token)).price === 60.5);
  ok("le client voit le prix", (await call("GET", "/pitches")).pitches[0].price === 60.5);
  const priced = await call("POST", "/client/reservations", slot, T);
  await call("PATCH", "/admin/pitches/1", { price: 80 }, a.token);
  ok("la réservation garde son prix", (await call("GET", "/client/reservations", null, T)).find(r => r.id === priced.id).price === 60.5);
  ok("le chef voit le prix", (await call("GET", "/terrain/board", null, chef.token)).pending.find(r => r.id === priced.id).price === 60.5);
  ok("l'admin peut retirer le prix", (await call("PATCH", "/admin/pitches/1", { price: null }, a.token)).price === null);

  console.log(failed ? `\n${failed} test(s) en échec` : "\nTous les tests passent.");
  process.exitCode = failed ? 1 : 0;
})().catch(err => { console.error(err); process.exitCode = 1; });
