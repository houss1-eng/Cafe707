// Espace client. Menu, connexion (code SMS), commandes, appels et suivi passent par l'API.

// ---------------------------------------------------------------------
// État
// ---------------------------------------------------------------------
const TOKEN_KEY = "707-client-token";
const PLACE_KEY = "707-place";
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

let FLOORS = [];
let TABS = [];
let PRODUCTS = [];
let CLIENT = null;             // null = pas connecté
let LAST_ORDER = [];

// Panier : clé unique par ligne (produit + options) -> { p, opts[], q }
const cart = new Map();
let currentCat = "pour-toi";
let currentSub = "";
let search = "";
let usePoints = false;
let sending = false;
let IS_OPEN = true;            // false = café fermé par l'admin
let place = null;              // { floorId, table }

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n) => Number(n).toFixed(1).replace(".", ",");
const byId = (id) => PRODUCTS.find(p => p.id === id);

// Prix unitaire d'une ligne = base + options (affichage ; le serveur recalcule)
const unitPrice = (p, opts = []) => p.price + opts.reduce((s, o) => s + o.price, 0);
const unitKcal = (p, opts = []) => p.kcal + opts.reduce((s, o) => s + o.kcal, 0);
const pointsOf = (price) => Math.floor(price + 1e-9);   // 1 point par DT

const STATUS_LABEL = {
  nouvelle: "Reçue", en_preparation: "En préparation", servie: "Servie", payee: "Payée", annulee: "Annulée",
};

async function api(url, options = {}) {
  const token = store.get(TOKEN_KEY);
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Connexion impossible");
    err.status = res.status;
    throw err;
  }
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

// ---------------------------------------------------------------------
// Terrasse + table : viennent uniquement du QR code de la table (?etage=1&table=4)
// ---------------------------------------------------------------------
const PLACE_TTL = 4 * 3600e3;   // au-delà, le client doit rescanner (il a pu changer de table)
const floorOf = (id) => FLOORS.find(f => f.id === id);
const floorName = (id) => (floorOf(id) || {}).name;
function validPlace(p) {
  const f = p && floorOf(p.floorId);
  if (!f || !/^\d{1,3}$/.test(String(p.table))) return false;
  const t = Number(p.table);
  return t >= f.tableFrom && t <= f.tableTo;
}

function loadPlace() {
  const q = new URLSearchParams(location.search);
  if (q.has("etage") || q.has("table")) {
    // Le QR vient d'être scanné : on le retient et on l'enlève de l'adresse,
    // pour qu'un ancien onglet ou l'historique ne renvoie pas vers une ancienne table
    history.replaceState(null, "", location.pathname);
    const scanned = { floorId: Number(q.get("etage")), table: String(Number(q.get("table"))), at: Date.now() };
    store.set(PLACE_KEY, validPlace(scanned) ? JSON.stringify(scanned) : null);
    return validPlace(scanned) ? scanned : null;
  }
  try {
    const saved = JSON.parse(store.get(PLACE_KEY));
    if (saved && saved.at && Date.now() - saved.at < PLACE_TTL && validPlace(saved)) return saved;
  } catch {}
  store.set(PLACE_KEY, null);
  return null;
}
function forgetPlace() {
  place = null;
  store.set(PLACE_KEY, null);
  renderPlace();
}
function renderPlace() {
  const ok = validPlace(place);
  const label = ok ? `${floorName(place.floorId)} · Table ${place.table}` : "";
  $("place-text").textContent = ok ? label : "Scanne le QR code de ta table";
  $("place-btn").classList.toggle("missing", !ok);
  $("cover-place").hidden = !ok;
  $("cover-place").innerHTML = `${ic("pin")}${esc(label)}`;
  $("hello").innerHTML = CLIENT ? `Bonjour,<b>${esc(CLIENT.name)}</b>` : "Bienvenue au<b>707 Café &amp; Resto</b>";
  $("bill-sub").textContent = ok ? label : "707 · Café & Resto";
}

// ---------------------------------------------------------------------
// Le menu : catégories en pastilles, cartes produits en grille
// ---------------------------------------------------------------------
const ic = (name) => `<svg class="i"><use href="#i-${name}"/></svg>`;

const qtyOf = (id) => { let q = 0; cart.forEach(l => { if (l.p.id === id) q += l.q; }); return q; };
const hasOpts = (p) => !!(p.groups && p.groups.length);

// Photo du produit, ou son initiale si aucune photo
const photo = (p) => p.image
  ? `<img src="${esc(p.image)}" alt="" loading="lazy">`
  : `<span class="monogram">${esc(p.name.charAt(0))}</span>`;

function qtyHtml(p) {
  if (p.soldOut) return "";
  const q = qtyOf(p.id);
  // Produit à options : chaque ajout passe par sa fiche (choix différents = lignes différentes)
  if (q && !hasOpts(p)) {
    return `<button class="qty-btn" data-minus="${p.id}" aria-label="Retirer un ${esc(p.name)}">−</button>
            <span class="qty-n">${q}</span>
            <button class="qty-btn add" data-open="${p.id}" aria-label="Ajouter un ${esc(p.name)}">+</button>`;
  }
  return `${q ? `<span class="qty-n">${q}</span>` : ""}
          <button class="qty-btn add" data-open="${p.id}" aria-label="Ajouter ${esc(p.name)}">+</button>`;
}
const qtyBox = (p) => `<div class="dish-qty ${qtyOf(p.id) && !hasOpts(p) ? "has" : ""}" data-qty="${p.id}">${qtyHtml(p)}</div>`;
const priceHtml = (p) => `<span class="price">${fmt(p.price)}<small>DT</small></span>`;

// Carte « Recommandé pour toi »
function cardHtml(p) {
  return `
    <li class="pcard ${p.soldOut ? "is-sold" : ""}">
      <button class="pimg" data-open="${p.id}" ${p.soldOut ? "disabled" : ""}>${photo(p)}
        ${p.soldOut ? `<span class="pbadge">Épuisé</span>` : p.badge ? `<span class="pbadge">${esc(p.badge)}</span>` : ""}</button>
      <button class="pname" data-open="${p.id}" ${p.soldOut ? "disabled" : ""}>${esc(p.name)}</button>
      ${p.note ? `<span class="pnote">${esc(p.note)}</span>` : ""}
      <div class="pfoot">${priceHtml(p)}${qtyBox(p)}</div>
    </li>`;
}

// Ligne d'une catégorie : photo, nom, description, prix, bouton +
function itemHtml(p) {
  const tags = [
    p.badge ? `<span class="tag hot">${esc(p.badge)}</span>` : "",
    p.soldOut ? `<span class="tag sold">Épuisé</span>` : "",
    hasOpts(p) ? `<span class="tag">${p.kind === "pizza" ? "À composer" : "Au choix"}</span>` : "",
  ].join("");
  return `
    <li class="card ${p.soldOut ? "is-sold" : ""}">
      <button class="card-img" data-open="${p.id}" ${p.soldOut ? "disabled" : ""}>${photo(p)}</button>
      <div class="card-body">
        <button class="card-name" data-open="${p.id}" ${p.soldOut ? "disabled" : ""}>${esc(p.name)}</button>
        ${p.note ? `<span class="card-note">${esc(p.note)}</span>` : ""}
        ${tags ? `<span class="card-tags">${tags}</span>` : ""}
        <div class="card-foot">${priceHtml(p)}${qtyBox(p)}</div>
      </div>
    </li>`;
}

// Rubriques : les favoris, puis chaque catégorie qui a des produits
function sections() {
  return TABS.filter(t => t.key === "pour-toi" ? PRODUCTS.some(p => p.fav) : PRODUCTS.some(p => p.cat === t.key));
}

function renderTabs() {
  $("tabs").innerHTML = sections().map(x =>
    `<button class="tab ${x.key === currentCat ? "active" : ""}" data-cat="${esc(x.key)}">${esc(x.label)}</button>`
  ).join("");
  renderCatTiles();
}
const renderSubTabs = () => {};

// Tuiles « Catégories » : la photo d'un produit de la catégorie
function renderCatTiles() {
  const cats = sections().filter(t => t.key !== "pour-toi");
  $("cats-count").textContent = `${cats.length} catégories`;
  $("cat-tiles").innerHTML = cats.map(t => {
    const p = PRODUCTS.find(x => x.cat === t.key && x.image) || PRODUCTS.find(x => x.cat === t.key);
    return `<button class="cat-tile" data-cat="${esc(t.key)}">${p ? photo(p) : ""}<span>${esc(t.label)}</span></button>`;
  }).join("");
}

function rubriqueHtml(t) {
  const fav = t.key === "pour-toi";
  const list = fav ? PRODUCTS.filter(p => p.fav) : PRODUCTS.filter(p => p.cat === t.key);
  let html = "";
  if (fav) {
    html = `<ul class="reco">${list.map(cardHtml).join("")}</ul>`;
  } else {
    let rows = "";
    if (t.subs) {
      t.subs.forEach(s => {
        const items = list.filter(p => p.sub === s);
        if (items.length) rows += `<li class="sec-head">${esc(s)}</li>` + items.map(itemHtml).join("");
      });
      rows += list.filter(p => !p.sub).map(itemHtml).join("");
    } else {
      rows = list.map(itemHtml).join("");
    }
    const compose = t.key === "salades" ? `
      <li class="compose"><div><h3>Compose ta salade</h3><p>Ta base, tes ingrédients, ta sauce.</p></div>
        <button class="again-btn" data-compose>Bientôt</button></li>` : "";
    html = `<ul class="grid">${compose}${rows}</ul>`;
  }
  const title = fav ? (CLIENT ? `Pour toi, ${esc(CLIENT.name)}` : "Recommandé pour toi") : esc(t.title);
  return `
    <li class="rubrique" id="rub-${esc(t.key)}" data-rub="${esc(t.key)}">
      <div class="rubrique-head"><h2 class="rubrique-title">${title}</h2><span class="rubrique-sub">${list.length} choix</span></div>
      ${html}
    </li>`;
}

function renderMenu() {
  const q = search.trim().toLowerCase();
  if (q) {
    const found = PRODUCTS.filter(p => p.name.toLowerCase().includes(q) || p.note.toLowerCase().includes(q));
    $("menu").innerHTML = `
      <li class="rubrique">
        <div class="rubrique-head"><h2 class="rubrique-title">Résultats</h2><span class="rubrique-sub">${found.length} trouvé${found.length > 1 ? "s" : ""}</span></div>
        <ul class="grid">${found.map(itemHtml).join("") || `<li class="empty">Rien trouvé. Essaie un autre mot.</li>`}</ul>
      </li>`;
  } else {
    $("menu").innerHTML = sections().map(rubriqueHtml).join("");
    watchRubriques();
  }
  $("again-text").textContent = LAST_ORDER.filter(l => byId(l.productId))
    .map(l => `${l.qty}× ${byId(l.productId).name}`).join(", ");
  $("again-box").hidden = !!q || !$("again-text").textContent;
  $("cats-head").hidden = $("cat-tiles").hidden = !!q;
}

// Met à jour seulement les boutons + / − (pas tout le menu)
function updateCounts() {
  document.querySelectorAll("[data-qty]").forEach(el => {
    const p = byId(Number(el.dataset.qty));
    if (!p) return;
    el.innerHTML = qtyHtml(p);
    el.classList.toggle("has", qtyOf(p.id) > 0 && !hasOpts(p));
  });
}

// Petit rebond du panier et du bouton + à chaque ajout
function celebrate(p) {
  const dock = $("dock");
  dock.classList.remove("bump");
  void dock.offsetWidth;
  dock.classList.add("bump");
  document.querySelectorAll(`[data-qty="${p.id}"] .add`).forEach(b => b.classList.add("pop"));
}

// La catégorie visible à l'écran est mise en avant dans les pastilles
let rubObserver = null;
function watchRubriques() {
  if (rubObserver) rubObserver.disconnect();
  if (!("IntersectionObserver" in window)) return;
  rubObserver = new IntersectionObserver(entries => {
    const top = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!top) return;
    currentCat = top.target.dataset.rub;
    document.querySelectorAll(".tab").forEach(t => {
      const on = t.dataset.cat === currentCat;
      t.classList.toggle("active", on);
      if (on) t.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    });
  }, { rootMargin: "-80px 0px -60% 0px" });
  document.querySelectorAll("[data-rub]").forEach(el => rubObserver.observe(el));
}

// ---------------------------------------------------------------------
// Panier
// ---------------------------------------------------------------------
// Points utilisables : multiple de 10, sans dépasser le solde ni le montant (10 pts = 1 DT)
function pointsUsable(subtotal) {
  if (!CLIENT) return 0;
  return Math.min(Math.floor(CLIENT.points / 10) * 10, Math.floor(subtotal + 1e-9) * 10);
}

function totals() {
  let count = 0, subtotal = 0, kcal = 0, earned = 0;
  cart.forEach(line => {
    const u = unitPrice(line.p, line.opts);
    count += line.q;
    subtotal += u * line.q;
    kcal += unitKcal(line.p, line.opts) * line.q;
    earned += pointsOf(u) * line.q;
  });
  const usable = pointsUsable(subtotal);
  const used = usePoints ? usable : 0;
  const total = subtotal - used / 10;
  if (used) earned = Math.min(earned, Math.floor(total + 1e-9));
  return { count, subtotal, kcal, earned, usable, used, total };
}

function renderCart() {
  const rows = [];
  cart.forEach((line, key) => {
    const optText = line.opts.length ? `<small class="line-opts">+ ${line.opts.map(o => esc(o.name)).join(", ")}</small>` : "";
    rows.push(`
      <div class="line">
        <span class="line-img">${photo(line.p)}</span>
        <span class="line-name">${esc(line.p.name)}${optText}<span class="line-price">${fmt(unitPrice(line.p, line.opts) * line.q)} DT</span></span>
        <div class="stepper">
          <button data-dec="${esc(key)}" aria-label="Retirer">−</button>
          <span>${line.q}</span>
          <button data-inc="${esc(key)}" aria-label="Ajouter">+</button>
        </div>
      </div>`);
  });
  const t = totals();

  $("lines").innerHTML = rows.length ? rows.join("") : `<div class="empty" style="padding:12px 0">Ton panier est vide.</div>`;
  $("dock-count").textContent = t.count ? `${t.count} article${t.count > 1 ? "s" : ""}` : "Panier vide";
  $("dock").classList.toggle("empty-cart", !t.count);
  $("nav-badge").hidden = !t.count;
  $("nav-badge").textContent = t.count;
  $("dock-total").innerHTML = `${fmt(t.total)}<i>DT</i>`;
  $("kcal").textContent = `≈ ${t.kcal} kcal`;
  $("total").textContent = `${fmt(t.total)} DT`;
  $("earned").textContent = `+${t.earned}`;

  $("use-points").hidden = !t.usable;
  $("use-points-box").checked = usePoints && t.usable > 0;
  $("use-points-text").innerHTML = `Utiliser <b>${t.usable} points</b> · −${fmt(t.usable / 10)} DT <small>(solde ${CLIENT ? CLIENT.points : 0})</small>`;

  $("order-btn").disabled = rows.length === 0 || sending || !IS_OPEN;
  $("order-btn").textContent = !IS_OPEN ? "Le 707 est fermé" : sending ? "Envoi…"
    : rows.length ? `Commander · ${fmt(t.total)} DT` : "Envoyer la commande";
  renderAccountPill();
  updateCounts();
}

function addLine(p, opts = [], delta = 1) {
  if (delta > 0 && !IS_OPEN) return toast("Le 707 est fermé pour le moment");
  const key = p.id + "|" + opts.map(o => o.id).sort().join(",");
  const existing = cart.get(key);
  const q = (existing ? existing.q : 0) + delta;
  if (q <= 0) cart.delete(key);
  else cart.set(key, { p, opts, q });
  renderCart();
  if (delta > 0) celebrate(p);
}

// Fermée : barre en bas. Ouverte : page entière « Votre commande » (l'addition)
function setDock(open) {
  $("dock").classList.toggle("open", open);
  $("dock-toggle").setAttribute("aria-expanded", open);
  $("dock-label").textContent = open ? "Mon panier" : "Voir le panier";
  $("dock-arrow").textContent = open ? "←" : "→";
  setNav(open ? "nav-cart" : "nav-home");
  document.body.style.overflow = open ? "hidden" : "";
  if (open) $("dock").scrollTop = 0;
}

// ---------------------------------------------------------------------
// Feuilles (options, connexion, compte, terrasse, appel, reçu)
// ---------------------------------------------------------------------
let sheetMode = null;
// Pages plein écran, avec une barre « ‹ Retour » en haut
function showSheet(mode, html) {
  sheetMode = mode;
  $("sheet").className = `sheet sheet-${mode}`;
  if (html !== undefined) $("sheet").innerHTML = html;
  $("sheet-bg").classList.add("show");
  $("sheet").scrollTop = 0;
  document.body.style.overflow = "hidden";
}
function closeSheet() {
  $("sheet-bg").classList.remove("show");
  sheetMode = null;
  sheetProduct = null;
  document.body.style.overflow = $("dock").classList.contains("open") ? "hidden" : "";
}
const closeBtn = `<button class="sheet-x" id="sheet-close" aria-label="Retour">‹ Retour</button>`;

// ---- Options d'un produit (pizza dessinée, ou liste simple) ----
let sheetProduct = null;
let sheetChoice = new Set();
let justAdded = null;

const allOpts = (p) => (p.groups || []).flatMap(g => g.items);
const chosenOpts = () => allOpts(sheetProduct).filter(i => sheetChoice.has(i.id));

// Dessin de la pizza : positions fixes (pseudo-aléatoires), la pizza ne "saute" pas
function seeded(seed) {
  let x = 0;
  for (const c of seed) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function spots(seed, n, rMax = 62) {
  const rnd = seeded(seed);
  return Array.from({ length: n }, (_, i) => {
    const a = i * 2.399963 + rnd() * 0.9;
    const r = Math.sqrt((i + 0.5) / n) * rMax * (0.85 + rnd() * 0.15);
    return { x: 100 + Math.cos(a) * r, y: 100 + Math.sin(a) * r, rot: Math.floor(rnd() * 180), k: rnd() };
  });
}
function blob(cx, cy, r, seed) {
  const rnd = seeded(seed);
  const pts = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2, rr = r * (0.93 + rnd() * 0.07);
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  });
  return "M" + pts.map(p => p.map(v => v.toFixed(1)).join(" ")).join(" L") + " Z";
}
const TOPPINGS = {
  fromage: () => spots("fromage", 14, 58).map(s =>
    `<ellipse cx="${s.x}" cy="${s.y}" rx="${11 + s.k * 7}" ry="${8 + s.k * 5}" transform="rotate(${s.rot} ${s.x} ${s.y})" fill="#f6d36b" opacity=".92"/>`).join(""),
  thon: () => spots("thon", 11).map(s =>
    `<path d="M${s.x - 6} ${s.y} q3 -6 8 -3 q5 2 3 7 q-4 4 -9 1 z" transform="rotate(${s.rot} ${s.x} ${s.y})" fill="#d9b49a" stroke="#b88d71" stroke-width="1"/>`).join(""),
  escalope: () => spots("escalope", 8).map(s =>
    `<g transform="rotate(${s.rot} ${s.x} ${s.y})"><rect x="${s.x - 10}" y="${s.y - 4}" width="20" height="8" rx="4" fill="#b5773f"/><path d="M${s.x - 5} ${s.y - 4} v8 M${s.x + 1} ${s.y - 4} v8 M${s.x + 6} ${s.y - 4} v8" stroke="#7a4a22" stroke-width="1.4"/></g>`).join(""),
  olives: () => spots("olives", 10).map(s =>
    `<circle cx="${s.x}" cy="${s.y}" r="5.5" fill="#1c1a17"/><circle cx="${s.x}" cy="${s.y}" r="2.2" fill="#6b2a1f"/>`).join(""),
};
const SAUCES = { "s-tomate": "#c2412d", "s-blanche": "#f1e7d2" };
const genericTopping = (id) => spots(id, 9).map(s => `<circle cx="${s.x}" cy="${s.y}" r="4" fill="#f58220"/>`).join("");

function pizzaSvg() {
  const ids = [...sheetChoice];
  const sauce = ids.find(id => SAUCES[id]);
  const toppings = ids.filter(id => !SAUCES[id]).sort((a, b) => (a === "fromage" ? -1 : b === "fromage" ? 1 : 0));
  const layer = (id, html) => `<g class="layer ${id === justAdded ? "drop" : ""}">${html}</g>`;
  return `
    <svg viewBox="0 0 200 200" role="img" aria-label="Ta pizza">
      <circle cx="100" cy="104" r="96" fill="#000" opacity=".35"/>
      <circle cx="100" cy="100" r="96" fill="#2a2320"/>
      <circle cx="100" cy="100" r="88" fill="#c98a42"/>
      <circle cx="100" cy="100" r="84" fill="#dca35a"/>
      <circle cx="100" cy="100" r="76" fill="#efc988"/>
      ${spots("pate", 18, 70).map(s => `<circle cx="${s.x}" cy="${s.y}" r="${1 + s.k * 1.5}" fill="#d8a960" opacity=".6"/>`).join("")}
      ${sauce ? layer(sauce, `<path d="${blob(100, 100, 74, sauce)}" fill="${SAUCES[sauce]}"/>`) : ""}
      ${toppings.map(id => layer(id, (TOPPINGS[id] || (() => genericTopping(id)))())).join("")}
    </svg>`;
}

function openProduct(p, showSheetAlways = false) {
  if (!hasOpts(p) && !showSheetAlways) {
    addLine(p, [], 1);
    toast(`${p.name} ajouté`);
    return;
  }
  sheetProduct = p;
  sheetChoice = new Set();
  justAdded = null;
  showSheet("pizza");
  drawOptionsSheet(true);
}

function drawOptionsSheet(first = false) {
  const p = sheetProduct;
  const chosen = chosenOpts();
  const isPizza = p.kind === "pizza";
  $("sheet").innerHTML = `
    ${closeBtn}
    <div class="pd-hero">${isPizza ? `<div class="pizza-stage ${first ? "enter" : ""}">${pizzaSvg()}</div>` : photo(p)}</div>
    <div class="pd-head"><h3>${esc(p.name)}</h3><span class="pd-price">${fmt(p.price)} DT</span></div>
    <p class="base">${isPizza ? "Ajoute ce que tu veux : ta pizza se garnit en direct." : esc(p.note || "")}</p>
    ${isPizza ? `<p class="pizza-recap">${chosen.length ? chosen.map(o => esc(o.name)).join(" · ") : "Pizza nature"} · ${unitKcal(p, chosen)} kcal</p>` : ""}
    ${(p.groups || []).map(g => `
      <div class="opt-group">
        <h4>${esc(g.title)}</h4>
        ${g.single
          ? `<div class="seg">${g.items.map(i => `
              <button class="seg-opt ${sheetChoice.has(i.id) ? "on" : ""}" data-opt="${esc(i.id)}">${esc(i.name)}${i.price ? `<small>+${fmt(i.price)}</small>` : ""}</button>`).join("")}</div>`
          : g.items.map(i => `
              <button class="extra ${sheetChoice.has(i.id) ? "on" : ""}" data-opt="${esc(i.id)}">
                <span>${esc(i.name)}</span><span class="p">${i.price ? "+" + fmt(i.price) + " DT" : "inclus"}</span>
                <span class="plus">${sheetChoice.has(i.id) ? "✓" : "+"}</span>
              </button>`).join("")}
      </div>`).join("")}
    <div class="sheet-foot">
      <span class="foot-price">${fmt(unitPrice(p, chosen))} DT</span>
      <button class="order-btn" id="sheet-add" ${IS_OPEN ? "" : "disabled"}>${IS_OPEN ? "Ajouter au panier" : "Le 707 est fermé"}</button>
    </div>
  `;
}

function toggleOpt(id) {
  const group = sheetProduct.groups.find(g => g.items.some(i => i.id === id));
  if (sheetChoice.has(id)) { sheetChoice.delete(id); justAdded = null; }
  else {
    if (group && group.single) group.items.forEach(i => sheetChoice.delete(i.id));
    sheetChoice.add(id);
    justAdded = id;
  }
  const scroll = $("sheet").scrollTop;
  drawOptionsSheet();
  $("sheet").scrollTop = scroll;
}

// ---- Connexion par code SMS ----
let afterLogin = null;
let login = { step: "phone", phone: "", isNew: false, devCode: "" };

function renderAccountPill() {
  $("acc-label").textContent = CLIENT ? `${CLIENT.points} pts` : "Compte";
  renderPlace();   // le message d'accueil dépend du client
}

function openLogin(then = null) {
  afterLogin = then;
  login = { step: "phone", phone: "", isNew: false, devCode: "" };
  showSheet("login");
  drawLogin();
}

function drawLogin(error = "") {
  const codeStep = login.step === "code";
  $("sheet").innerHTML = `
    ${closeBtn}
    <h3>${codeStep && login.isNew ? "Bienvenue au 707 !" : "Ton espace client"}</h3>
    <p class="base">${codeStep
      ? `Code envoyé par SMS au ${esc(login.phone.replace(/(\d{2})(\d{3})(\d{3})/, "$1 $2 $3"))}.`
      : "Ton numéro te permet de gagner des points, de les utiliser et de suivre tes commandes."}</p>
    ${codeStep ? `
      ${login.isNew ? `
      <div class="opt-group">
        <h4>Ton prénom</h4>
        <input class="search" id="name-input" type="text" maxlength="40" placeholder="Ex. Sami" autocomplete="given-name">
      </div>` : ""}
      <div class="opt-group">
        <h4>Code à 6 chiffres</h4>
        <input class="search table-input" id="code-input" type="text" inputmode="numeric" maxlength="6"
               placeholder="••••••" autocomplete="one-time-code">
        ${login.devCode ? `<p class="hint">Mode test (pas de SMS) : le code est <b>${esc(login.devCode)}</b></p>` : ""}
        <button class="link" id="resend">Changer de numéro</button>
      </div>`
    : `
      <div class="opt-group">
        <h4>Numéro de téléphone</h4>
        <input class="search table-input" id="phone-input" type="tel" inputmode="numeric" maxlength="8"
               placeholder="Ex. 22123456" value="${esc(login.phone)}" autocomplete="tel">
      </div>`}
    <p class="form-error" id="login-error">${esc(error)}</p>
    <button class="order-btn" id="login-ok">${codeStep ? "Valider" : "Recevoir mon code"}</button>
  `;
  setTimeout(() => {
    const el = $(codeStep ? (login.isNew ? "name-input" : "code-input") : "phone-input");
    if (el) el.focus();
  }, 50);
}

async function submitLogin() {
  const btn = $("login-ok");
  btn.disabled = true;
  try {
    if (login.step === "phone") {
      login.phone = $("phone-input").value.replace(/\D/g, "");
      if (!/^\d{8}$/.test(login.phone)) return drawLogin("Le numéro doit avoir 8 chiffres.");
      const r = await api("/api/client/code", { method: "POST", body: JSON.stringify({ phone: login.phone }) });
      login = { ...login, step: "code", isNew: r.isNew, devCode: r.devCode || "" };
      return drawLogin();
    }
    const code = $("code-input").value.replace(/\D/g, "");
    const name = $("name-input") ? $("name-input").value.trim() : "";
    if (login.isNew && name.length < 2) return drawLogin("Écris ton prénom.");
    if (code.length !== 6) return drawLogin("Le code a 6 chiffres.");
    const r = await api("/api/client/verify", { method: "POST", body: JSON.stringify({ phone: login.phone, code, name }) });
    store.set(TOKEN_KEY, r.token);
    await loadClient();
    closeSheet();
    toast(`Salut ${CLIENT.name} · ${CLIENT.points} points`);
    renderMenu();
    startLive();
    const next = afterLogin;
    afterLogin = null;
    if (next) next();
  } catch (err) {
    drawLogin(err.message);
  } finally {
    if ($("login-ok")) $("login-ok").disabled = false;
  }
}

async function loadClient() {
  if (!store.get(TOKEN_KEY)) { CLIENT = null; LAST_ORDER = []; return; }
  try {
    CLIENT = await api("/api/client/me");
    LAST_ORDER = CLIENT.lastOrder;
  } catch (err) {
    if (err.status === 401) { store.set(TOKEN_KEY, null); CLIENT = null; LAST_ORDER = []; }
    else throw err;
  }
  renderAccountPill();
}

// ---- Mon compte + reçus ----
async function openAccount() {
  showSheet("account", `<p class="base">Chargement…</p>`);
  try { await loadClient(); } catch {}
  if (!CLIENT) return openLogin();
  const orders = CLIENT.orders || [];
  $("sheet").innerHTML = `
    ${closeBtn}
    <div class="profile">
      <div class="profile-top">
        <span class="avatar">${esc(CLIENT.name.charAt(0).toUpperCase())}</span>
        <span><b>${esc(CLIENT.name)}</b><small>+216 ${esc(CLIENT.phone.replace(/(\d{2})(\d{3})(\d{3})/, "$1 $2 $3"))}</small></span>
      </div>
      <div class="account-points">
        <span class="cup">${ic("cup")}</span>
        <span>Fidélité 707<small>10 points = 1 DT dans le panier</small></span>
        <b>${CLIENT.points} pts</b>
      </div>
    </div>
    <div class="opt-group">
      <h4>Mes commandes</h4>
      ${orders.length ? orders.map(o => `
        <button class="hist" data-receipt="${o.id}">
          <span class="hist-img">${(() => { const p = PRODUCTS.find(x => x.name === (o.items[0] || {}).name); return p ? photo(p) : ""; })()}</span>
          <span class="hist-main">
          <span class="hist-top">
            <b>N°${o.id}</b>
            <span class="status s-${o.ready && ["nouvelle", "en_preparation"].includes(o.status) ? "servie" : o.status}">
              ${o.ready && ["nouvelle", "en_preparation"].includes(o.status) ? "Prête" : STATUS_LABEL[o.status] || o.status}</span>
          </span>
          <span class="hist-items">${(o.items || []).map(i => `${i.qty}× ${esc(i.name)}`).join(", ")}</span>
          <small>${dateTime(o.createdAt)} · Table ${esc(o.table)} · ${fmt(o.total)} DT</small>
          </span>
        </button>`).join("") : `<p class="hint">Pas encore de commande.</p>`}
    </div>
    <button class="order-btn ghost" id="logout-btn">Se déconnecter</button>
  `;
}

const dateTime = (d) => new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function openReceipt(id) {
  const o = (CLIENT.orders || []).find(x => x.id === id);
  if (!o) return;
  showSheet("receipt", `
    ${closeBtn}
    <div class="receipt" id="receipt">
      <img src="logo707.png" alt="">
      <h3>707 Café & Resto</h3>
      <p class="muted">Reçu n°${o.id} · ${dateTime(o.createdAt)}<br>${esc(o.floor)} · Table ${esc(o.table)}</p>
      <table>
        ${o.items.map(i => `
          <tr><td>${i.qty}× ${esc(i.name)}${i.options && i.options.length ? `<br><small>+ ${i.options.map(x => esc(x.name)).join(", ")}</small>` : ""}</td>
              <td>${fmt(i.unit * i.qty)}</td></tr>`).join("")}
        ${o.discount ? `<tr class="sub"><td>Sous-total</td><td>${fmt(o.subtotal)}</td></tr>
                        <tr class="sub"><td>Payé en points (${o.pointsUsed} pts)</td><td>−${fmt(o.discount)}</td></tr>` : ""}
        <tr class="tot"><td>Total</td><td>${fmt(o.total)} DT</td></tr>
      </table>
      <p class="muted">${STATUS_LABEL[o.status]}${o.paidAt ? " · " + esc(o.payment) : ""} · +${o.pointsEarned} points</p>
    </div>
    <button class="order-btn ghost" id="back-account">← Mes commandes</button>
  `);
}

async function logout() {
  await api("/api/client/logout", { method: "POST" }).catch(() => {});
  store.set(TOKEN_KEY, null);
  CLIENT = null;
  LAST_ORDER = [];
  usePoints = false;
  stopLive();
  closeSheet();
  renderCart();
  renderMenu();
  toast("Déconnecté");
}

// ---- Pas de table connue : il faut scanner le QR code ----
function openPlace() {
  showSheet("place", `
    ${closeBtn}
    <h3>Scanne ta table</h3>
    <p class="base">Ouvre l'appareil photo de ton téléphone et scanne le QR code posé sur ta table. On saura tout de suite où t'apporter ta commande.</p>
    <button class="order-btn" id="place-ok">J'ai compris</button>
  `);
}

// ---- Appeler le serveur / l'addition ----
function openCall() {
  // Fermé : seule l'addition reste possible, pour les clients encore à table
  if (!validPlace(place)) return openPlace();
  if (!CLIENT) return openLogin(openCall);
  showSheet("call", `
    ${closeBtn}
    <h3>Appeler le serveur</h3>
    <p class="base">${esc(floorName(place.floorId))} · Table ${esc(place.table)}</p>
    <button class="call-opt" data-call="serveur" ${IS_OPEN ? "" : "hidden"}><span>${ic("bell")}</span><b>Appeler le serveur</b><small>Il passe à ta table</small></button>
    <button class="call-opt" data-call="addition"><span>${ic("list")}</span><b>Demander l'addition</b><small>Ton serveur te l'apporte</small></button>
  `);
}

async function sendCall(kind) {
  try {
    await api("/api/client/calls", {
      method: "POST",
      body: JSON.stringify({ floorId: place.floorId, table: place.table, kind }),
    });
    closeSheet();
    toast(kind === "addition" ? "Ton serveur arrive avec l'addition" : "Ton serveur est prévenu");
    startLive();
  } catch (err) {
    toast(err.message);
    if (err.status === 401) { store.set(TOKEN_KEY, null); CLIENT = null; openLogin(openCall); }
    if (/fermé/i.test(err.message)) refreshOpen();
  }
}

// ---------------------------------------------------------------------
// Événements des feuilles
// ---------------------------------------------------------------------
$("sheet").addEventListener("click", e => {
  if (e.target.closest("#sheet-close")) return closeSheet();
  const t = (sel) => e.target.closest(sel);
  switch (sheetMode) {
    case "pizza": {
      const opt = t("[data-opt]");
      if (opt) return toggleOpt(opt.dataset.opt);
      if (t("#sheet-add")) {
        addLine(sheetProduct, chosenOpts(), 1);
        toast(`${sheetProduct.name} ajouté`);
        closeSheet();
      }
      break;
    }
    case "place":
      if (t("#place-ok")) closeSheet();
      break;
    case "login":
      if (t("#login-ok")) submitLogin();
      if (t("#resend")) { login.step = "phone"; drawLogin(); }
      break;
    case "account": {
      if (t("#logout-btn")) return logout();
      const r = t("[data-receipt]");
      if (r) openReceipt(Number(r.dataset.receipt));
      break;
    }
    case "receipt":
      if (t("#back-account")) openAccount();
      break;
    case "call": {
      const c = t("[data-call]");
      if (c) sendCall(c.dataset.call);
      break;
    }
  }
});
$("sheet").addEventListener("input", e => {
  const digits = { "phone-input": 8, "code-input": 6 }[e.target.id];
  if (!digits) return;
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, digits);
  const err = $("login-error");
  if (err) err.textContent = "";
  // Code complet : validation automatique
  if (e.target.id === "code-input" && e.target.value.length === 6 && !(login.isNew && !$("name-input").value.trim())) submitLogin();
});
$("sheet").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  if (["phone-input", "code-input", "name-input"].includes(e.target.id)) submitLogin();
});
$("sheet-bg").addEventListener("click", e => { if (e.target.id === "sheet-bg") closeSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && sheetMode) closeSheet(); });

// ---------------------------------------------------------------------
// Menu, panier, onglets
// ---------------------------------------------------------------------
$("menu").addEventListener("click", e => {
  if (e.target.closest("[data-compose]")) return toast("Compose ta salade : bientôt disponible");
  // − : retire un exemplaire (produits sans options)
  const minus = e.target.closest("[data-minus]");
  if (minus) {
    const p = byId(Number(minus.dataset.minus));
    if (p) addLine(p, [], -1);
    return;
  }
  const btn = e.target.closest("[data-open]");
  if (!btn) return;
  const p = byId(Number(btn.dataset.open));
  if (p && !p.soldOut) openProduct(p, !btn.classList.contains("qty-btn"));
});
$("lines").addEventListener("click", e => {
  const btn = e.target.closest("[data-inc], [data-dec]");
  if (!btn) return;
  const line = cart.get(btn.dataset.inc || btn.dataset.dec);
  if (line) addLine(line.p, line.opts, btn.dataset.inc ? 1 : -1);
});
$("dock-toggle").addEventListener("click", () => setDock(!$("dock").classList.contains("open")));
// Rubrique touchée : on descend jusqu'à elle dans la carte
$("tabs").addEventListener("click", e => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  if (search) closeSearch();
  const rub = document.getElementById(`rub-${tab.dataset.cat}`);
  if (rub) rub.scrollIntoView({ behavior: "smooth", block: "start" });
});

// Recherche : la loupe ouvre le champ ; la refermer remet toute la carte
function closeSearch() {
  search = "";
  $("search").value = "";
  renderMenu();
}
$("search-toggle").addEventListener("click", () => {
  if (!$("search-row").hidden) return closeSearch();
  $("search-row").hidden = false;
  $("search-toggle").classList.add("on");
  $("search").focus();
});
$("search").addEventListener("input", e => { search = e.target.value; renderMenu(); });

$("logo-btn").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
$("points-pill").addEventListener("click", () => (CLIENT ? openAccount() : openLogin()));
$("call-btn").addEventListener("click", openCall);
$("place-btn").addEventListener("click", () => { if (!validPlace(place)) openPlace(); });
// Barre de navigation du bas
function setNav(id) {
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("on", b.id === id));
}
const scrollToRub = (key) => {
  if (search) closeSearch();
  const rub = document.getElementById(`rub-${key}`);
  if (rub) rub.scrollIntoView({ behavior: "smooth", block: "start" });
};
$("nav-home").addEventListener("click", () => { setDock(false); closeSheet(); setNav("nav-home"); window.scrollTo({ top: 0, behavior: "smooth" }); });
$("nav-menu").addEventListener("click", () => {
  setDock(false); closeSheet(); setNav("nav-menu");
  const first = sections().find(t => t.key !== "pour-toi");
  if (first) scrollToRub(first.key);
});
$("nav-cart").addEventListener("click", () => {
  if (!cart.size) return toast("Ton panier est vide");
  closeSheet(); setDock(true);
});
$("nav-orders").addEventListener("click", () => { setDock(false); CLIENT ? openAccount() : openLogin(openAccount); });
$("filter-btn").addEventListener("click", () => $("cats-head").scrollIntoView({ behavior: "smooth", block: "start" }));
$("cat-tiles").addEventListener("click", e => {
  const t = e.target.closest("[data-cat]");
  if (t) scrollToRub(t.dataset.cat);
});
$("credits-btn").addEventListener("click", openCredits);

// Auteurs et licences des photos (Wikimedia Commons)
async function openCredits() {
  showSheet("credits", `${closeBtn}<h3>Crédits photos</h3><p class="base">Chargement…</p>`);
  try {
    const list = await api("/api/credits");
    $("sheet").innerHTML = `${closeBtn}<h3>Crédits photos</h3>
      <p class="base">Photos d'illustration issues de Wikimedia Commons, sous licences libres.</p>
      <ul class="credits">${list.map(c => {
        const p = byId(c.productId);
        return `<li><b>${esc(p ? p.name : "Produit " + c.productId)}</b> · ${esc(c.author)} · ${esc(c.license)} ·
          <a href="${esc(c.source)}" target="_blank" rel="noopener">source</a></li>`;
      }).join("")}</ul>`;
  } catch (err) { toast(err.message); }
}

$("use-points-box").addEventListener("change", e => { usePoints = e.target.checked; renderCart(); });

$("reorder-btn").addEventListener("click", () => {
  if (!IS_OPEN) return toast("Le 707 est fermé pour le moment");
  cart.clear();
  let skipped = 0;
  LAST_ORDER.forEach(l => {
    const p = byId(l.productId);
    if (!p || p.soldOut) { skipped++; return; }
    addLine(p, allOpts(p).filter(o => l.optionIds.includes(o.id)), l.qty);
  });
  renderCart();
  setDock(true);
  toast(skipped ? "Dernière commande ajoutée (sauf produits épuisés)" : "Ta dernière commande est dans le panier");
});

// Envoyer : connexion -> terrasse + table -> envoi
function startOrder() {
  if (sending || !cart.size) return;
  if (!IS_OPEN) return toast("Le 707 est fermé pour le moment");
  if (!validPlace(place)) return openPlace();
  if (!CLIENT) return openLogin(startOrder);
  sendOrder();
}
$("order-btn").addEventListener("click", startOrder);

async function sendOrder() {
  sending = true;
  renderCart();
  try {
    const lines = [...cart.values()].map(l => ({ productId: l.p.id, qty: l.q, optionIds: l.opts.map(o => o.id) }));
    const res = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({ floorId: place.floorId, table: place.table, lines, usePoints: totals().used }),
    });
    CLIENT.points = res.points;
    LAST_ORDER = lines;
    cart.clear();
    usePoints = false;
    setDock(false);
    toast(`Commande n°${res.orderId} envoyée · ${fmt(res.total)} DT · +${res.pointsEarned} pts`);
    startLive();
  } catch (err) {
    toast(err.message);
    if (err.status === 401) { store.set(TOKEN_KEY, null); CLIENT = null; openLogin(startOrder); }
    else if (/fermé/i.test(err.message)) refreshOpen();
    else if (/terrasse|table/i.test(err.message)) { forgetPlace(); openPlace(); }
    else if (/points/i.test(err.message)) loadClient().catch(() => {});
    loadMenu().catch(() => {});
  } finally {
    sending = false;
    renderCart();
    renderMenu();
  }
}

// ---------------------------------------------------------------------
// Suivi en direct : statut des commandes, appels
// ---------------------------------------------------------------------
let liveTimer = null;
let liveSeen = null;           // dernier état connu : "id:statut:prête" et "appel:statut"

const liveLabel = (o) => {
  if (o.status === "annulee") return "annulée";
  if (o.status === "payee") return "payée, merci !";
  if (o.status === "servie") return "servie, bon appétit !";
  if (o.ready) return "prête, elle arrive !";
  return o.status === "en_preparation" ? "en préparation" : "reçue";
};

async function pollLive() {
  if (!CLIENT) return stopLive();
  let live;
  try { live = await api("/api/client/live"); } catch (err) {
    if (err.status === 401) { store.set(TOKEN_KEY, null); CLIENT = null; renderCart(); stopLive(); }
    return;
  }
  const state = new Map();
  live.orders.forEach(o => state.set(`o${o.id}`, `${o.status}:${o.ready}`));
  live.calls.forEach(c => state.set(`c${c.id}`, c.status));
  if (liveSeen) {
    for (const o of live.orders) {
      const before = liveSeen.get(`o${o.id}`);
      if (before && before !== `${o.status}:${o.ready}`) notify(`Commande n°${o.id} ${liveLabel(o)}`);
    }
    for (const c of live.calls) {
      if (liveSeen.get(`c${c.id}`) === "ouvert" && c.status === "traite") {
        notify(c.kind === "addition" ? "Ton serveur arrive avec l'addition" : "Ton serveur arrive");
      }
    }
  }
  liveSeen = state;
  if (CLIENT.points !== live.points) { CLIENT.points = live.points; renderCart(); }

  const active = live.orders.filter(o => !["payee", "annulee"].includes(o.status));
  const openCalls = live.calls.filter(c => c.status === "ouvert");
  $("live").hidden = !active.length && !openCalls.length;
  $("live").innerHTML = active.map(o => {
      // Reçue → En préparation → Prête → Servie
      const at = o.status === "servie" ? 3 : o.ready ? 2 : o.status === "en_preparation" ? 1 : 0;
      const steps = [["check", "Reçue"], ["cup", "Préparation"], ["fire", "Prête"], ["plate", "Servie"]];
      return `
      <div class="track">
        <div class="track-head"><span><small>Commande n°${o.id}</small><br><b>${liveLabel(o).replace(/^./, c => c.toUpperCase())}</b></span></div>
        <div class="steps">${steps.map(([icon, label], i) =>
          `<span class="step ${i < at ? "done" : i === at ? "now" : ""}"><i>${ic(i < at ? "check" : icon)}</i>${label}</span>`).join("")}</div>
      </div>`;
    }).join("")
    + openCalls.map(c => `
      <div class="call-line"><span class="dot"></span>${c.kind === "addition" ? "Addition demandée" : "Serveur appelé"} · il arrive</div>`).join("");
  // On continue tant qu'il reste quelque chose à suivre
  if (!active.length && !openCalls.length) stopLive();
}

function notify(msg) {
  toast(msg);
  if (navigator.vibrate) navigator.vibrate([150, 80, 150]);
  if (document.hidden && "Notification" in window && Notification.permission === "granted") {
    try { new Notification("707 Café", { body: msg, icon: "logo707.png" }); } catch {}
  }
}

function startLive() {
  // Permission des notifications demandée après un geste (commande, appel)
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
  if (liveTimer) return pollLive();
  liveTimer = setInterval(pollLive, 7000);
  pollLive();
}
function stopLive() {
  clearInterval(liveTimer);
  liveTimer = null;
}

// ---------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------
// Le café ouvre ou ferme : l'app du client suit toute seule
function applyOpen(open) {
  if (open === IS_OPEN) return;
  IS_OPEN = open;
  document.body.classList.toggle("closed", !open);
  $("closed-banner").hidden = open;
  if (sheetMode === "pizza") closeSheet();
  renderCart();
}
async function refreshOpen() {
  try {
    const was = IS_OPEN;
    applyOpen((await api("/api/status")).open);
    if (was !== IS_OPEN) toast(IS_OPEN ? "Le 707 est ouvert, tu peux commander" : "Le 707 vient de fermer");
  } catch {}
}
setInterval(refreshOpen, 15000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshOpen(); });

async function loadMenu() {
  const menu = await api("/api/menu");
  FLOORS = menu.floors;
  TABS = [{ key: "pour-toi", label: "Favoris", title: "Nos favoris" }, ...menu.tabs];
  PRODUCTS = menu.products;
  applyOpen(menu.open);
  // Le panier garde les objets à jour (prix, épuisé) ; un produit retiré du menu sort du panier
  cart.forEach((line, key) => {
    const fresh = byId(line.p.id);
    if (fresh) line.p = fresh; else cart.delete(key);
  });
}

async function init() {
  try {
    await Promise.all([loadMenu(), loadClient().catch(() => {})]);
    place = loadPlace();
    renderPlace();
    renderTabs();
    renderMenu();
    renderCart();
    if (CLIENT) startLive();
  } catch (err) {
    $("menu").innerHTML = `<li class="empty">Menu indisponible : ${esc(err.message)}.<br>Vérifie ta connexion.</li>`;
  }
}

init();
