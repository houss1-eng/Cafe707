// Espace admin : voit tout. Tableau de bord, commandes, caisse, rapports, menu, terrasses & QR, équipe.

let me = null;
let view = "dash";
let floors = [];
let refreshTimer = null;

const VIEWS = [
  ["dash", "Tableau de bord"], ["orders", "Commandes"], ["cash", "Caisse"], ["reports", "Rapports"],
  ["pitches", "Terrains"], ["menu", "Menu"], ["floors", "Terrasses & QR"], ["team", "Équipe"],
];
const ROLE_LABEL = { admin: "Admin", serveur: "Serveur", cuisine: "Cuisine", bar: "Bar", terrain: "Chef de terrain" };

// Journée de travail (commence à 5 h, comme sur le serveur)
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const bizToday = () => isoDay(new Date(Date.now() - 5 * 3600e3));
const addDays = (s, n) => { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + n); return isoDay(d); };
const frDay = (s) => new Date(`${s}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });

function renderShell() {
  $("app").innerHTML = `
    <header class="bo-head">
      <img src="logo707.png" alt="707">
      <div><h1>707 · Admin</h1><p>${esc(me.name)}</p></div>
      <span class="spacer"></span>
      <a class="btn" href="serveur.html">Vue serveur</a>
      <a class="btn" href="cuisine.html">Cuisine</a>
      <a class="btn" href="terrain.html">Terrains</a>
      <button class="btn" id="logout">Sortir</button>
    </header>
    <div class="open-bar" id="open-bar"></div>
    <div class="admin-layout">
      <aside class="side">
        <nav class="bo-tabs" id="views">
          ${VIEWS.map(([k, l]) => `<button data-view="${k}" class="${view === k ? "on" : ""}">${l}</button>`).join("")}
        </nav>
      </aside>
      <section id="view"></section>
    </div>`;
  $("logout").addEventListener("click", staffLogout);
  $("open-bar").addEventListener("click", onOpenClick);
  loadOpen();
  $("views").addEventListener("click", e => {
    const b = e.target.closest("[data-view]");
    if (!b) return;
    view = b.dataset.view;
    document.querySelectorAll("#views button").forEach(x => x.classList.toggle("on", x === b));
    show();
  });
}

// ---- Café disponible / non disponible ----
let cafeOpen = null;
function drawOpen() {
  $("open-bar").className = `open-bar ${cafeOpen ? "is-open" : "is-closed"}`;
  $("open-bar").innerHTML = `
    <div><b>${cafeOpen ? "Le café est disponible" : "Le café est non disponible"}</b>
      <small>${cafeOpen ? "Les clients peuvent commander." : "Aucune nouvelle commande. Les clients voient seulement la carte."}</small></div>
    <div class="open-switch" role="group" aria-label="État du café">
      <button data-open-state="1" class="${cafeOpen ? "on" : ""}" aria-pressed="${cafeOpen}">Dispo</button>
      <button data-open-state="0" class="${cafeOpen ? "" : "on"}" aria-pressed="${!cafeOpen}">Non dispo</button>
    </div>`;
}
async function loadOpen() {
  try { cafeOpen = (await api("/api/status")).open; drawOpen(); } catch (err) { toast(err.message); }
}
async function onOpenClick(e) {
  const b = e.target.closest("[data-open-state]");
  if (!b) return;
  const open = b.dataset.openState === "1";
  if (open === cafeOpen) return;
  if (!open && !confirm("Fermer le café ? Plus aucun client ne pourra commander.")) return;
  try {
    cafeOpen = (await api("/api/admin/status", { method: "PATCH", body: JSON.stringify({ open }) })).open;
    drawOpen();
    toast(cafeOpen ? "Café disponible : les commandes sont ouvertes" : "Café non disponible : commandes arrêtées");
  } catch (err) { toast(err.message); }
}

function show() {
  clearInterval(refreshTimer);
  // Nouvelle zone vide : les écouteurs de l'onglet précédent disparaissent avec l'ancienne
  const old = $("view");
  old.replaceWith(old.cloneNode(false));
  ({ dash: showDash, orders: showOrders, cash: showCash, reports: showReports,
     pitches: showPitches, menu: showMenu, floors: showFloors, team: showTeam })[view]();
}

// Terrains : même tableau que le chef de terrain
async function showPitches() {
  $("view").innerHTML = `
    <section class="panel"><h2>Prix des terrains</h2>
      <div class="pp-list" id="pitch-prices"><p class="muted">Chargement…</p></div>
      <p class="muted pp-note">Prix pour une heure. Un nouveau prix s'applique aux prochaines demandes, pas aux réservations déjà faites.</p>
    </section>
    <div id="pitch-board"></div>`;
  refreshTimer = setInterval(mountPitchBoard($("pitch-board")), 8000);
  const box = $("pitch-prices");
  try {
    const { pitches } = await api("/api/pitches");
    if (!box.isConnected) return;
    box.innerHTML = pitches.map(p => `
      <form class="pp-row" data-pitch="${p.id}">
        <label for="pp-${p.id}">${esc(p.name)}</label>
        <span class="pp-input"><input id="pp-${p.id}" type="number" inputmode="decimal" min="0.001" max="9999" step="0.001"
          placeholder="Prix" value="${p.price ?? ""}"><i>DT / heure</i></span>
        <button class="btn primary">Enregistrer</button>
      </form>`).join("");
  } catch (err) { toast(err.message); }
  box.addEventListener("submit", async e => {
    e.preventDefault();
    const form = e.target.closest("[data-pitch]");
    const raw = form.querySelector("input").value.trim();
    const btn = form.querySelector("button");
    btn.disabled = true;
    try {
      const r = await api(`/api/admin/pitches/${form.dataset.pitch}`, { method: "PATCH",
        body: JSON.stringify({ price: raw === "" ? null : Number(raw) }) });
      toast(r.price === null ? "Prix retiré" : `Prix enregistré : ${String(r.price).replace(".", ",")} DT / heure`);
    } catch (err) { toast(err.message); }
    btn.disabled = false;
  });
}

const bars = (rows, label, value, text) => {
  const max = Math.max(1, ...rows.map(value));
  return rows.map(r => `
    <div class="bar-row">
      <span>${label(r)}</span>
      <span class="bar"><i style="width:${(value(r) / max) * 100}%"></i></span>
      <span>${text(r)}</span>
    </div>`).join("");
};

// =====================================================================
// Tableau de bord
// =====================================================================
async function showDash() {
  const draw = async () => {
    try {
      const s = await api("/api/admin/stats");
      const active = s.floors.reduce((n, f) => n + f.active, 0);
      $("view").innerHTML = `
        <div class="kpis">
          <div class="kpi"><span>Chiffre du jour</span><b>${fmt(s.revenue)}<i>DT</i></b></div>
          <div class="kpi"><span>Commandes du jour</span><b>${s.orders}</b></div>
          <div class="kpi"><span>En cours</span><b>${active}</b></div>
          <div class="kpi"><span>Appels en attente</span><b>${s.openCalls}</b></div>
          <div class="kpi"><span>Annulées</span><b>${s.statuses.annulee || 0}</b></div>
        </div>
        <div class="grid2">
          <div class="panel"><h2>Par terrasse</h2>
            ${bars(s.floors, f => esc(f.name), f => f.revenue,
              f => `${fmt(f.revenue)} DT · ${f.orders} cmd${f.active ? ` · <b style="color:var(--gold-ink)">${f.active} en cours</b>` : ""}`)}
          </div>
          <div class="panel"><h2>Top produits du jour</h2>
            ${s.top.length ? bars(s.top, p => `${esc(p.icon)} ${esc(p.name)}`, p => p.qty, p => p.qty)
              : `<p class="muted">Pas encore de vente aujourd'hui.</p>`}
          </div>
        </div>`;
    } catch (err) { toast(err.message); }
  };
  await draw();
  refreshTimer = setInterval(draw, 10000);
}

// =====================================================================
// Commandes (toutes les terrasses)
// =====================================================================
let orderFilter = { floor: "", scope: "active" };
async function showOrders() {
  let shown = [];
  $("view").innerHTML = `
    <div class="bo-filters">
      <select id="f-floor">
        <option value="">Toutes les terrasses</option>
        ${floors.map(f => `<option value="${f.id}" ${String(f.id) === orderFilter.floor ? "selected" : ""}>${esc(f.name)}</option>`).join("")}
      </select>
      <select id="f-scope">
        <option value="active" ${orderFilter.scope === "active" ? "selected" : ""}>En cours</option>
        <option value="today" ${orderFilter.scope === "today" ? "selected" : ""}>Toutes aujourd'hui</option>
        <option value="done" ${orderFilter.scope === "done" ? "selected" : ""}>Terminées aujourd'hui</option>
      </select>
      <span class="muted" id="f-count"></span>
    </div>
    <section class="orders" id="orders"></section>`;
  const load = async () => {
    try {
      const q = new URLSearchParams({ scope: orderFilter.scope, ...(orderFilter.floor ? { floor: orderFilter.floor } : {}) });
      shown = await api(`/api/staff/orders?${q}`);
      $("f-count").textContent = `${shown.length} commande${shown.length > 1 ? "s" : ""}`;
      $("orders").innerHTML = shown.length ? shown.map(o => orderCard(o, { showFloor: true })).join("")
        : `<p class="empty-box">Aucune commande.</p>`;
    } catch (err) { toast(err.message); }
  };
  $("f-floor").addEventListener("change", e => { orderFilter.floor = e.target.value; load(); });
  $("f-scope").addEventListener("change", e => { orderFilter.scope = e.target.value; load(); });
  bindOrderActions($("orders"), load, id => shown.find(o => o.id === id));
  await load();
  refreshTimer = setInterval(load, 8000);
}

// =====================================================================
// Caisse
// =====================================================================
let cashDay = null;
async function showCash() {
  try {
    const c = await api(`/api/admin/cash${cashDay ? `?day=${cashDay}` : ""}`);
    cashDay = c.day;
    $("view").innerHTML = `
      <div class="bo-filters">
        <button class="btn" data-shift="-1">‹</button>
        <input type="date" id="cash-day" value="${c.day}" max="${bizToday()}">
        <button class="btn" data-shift="1" ${c.day >= bizToday() ? "disabled" : ""}>›</button>
        <span class="muted">${frDay(c.day)}</span>
      </div>
      <div class="kpis">
        <div class="kpi"><span>Total encaissé</span><b>${fmt(c.total)}<i>DT</i></b></div>
        <div class="kpi"><span>Espèces</span><b>${fmt(c.especes)}<i>DT</i></b></div>
        <div class="kpi"><span>Carte</span><b>${fmt(c.carte)}<i>DT</i></b></div>
        <div class="kpi"><span>Commandes encaissées</span><b>${c.count}</b></div>
        <div class="kpi"><span>Payé en points</span><b>${fmt(c.pointsDiscount)}<i>DT</i></b></div>
      </div>
      <div class="panel">
        <h2>Par serveur</h2>
        ${c.staff.length ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Serveur</th><th>Commandes</th><th>Espèces</th><th>Carte</th><th>Total</th></tr></thead>
          <tbody>${c.staff.map(s => `<tr><td>${esc(s.name)}</td><td>${s.count}</td><td>${fmt(s.especes)}</td>
            <td>${fmt(s.carte)}</td><td><b>${fmt(s.especes + s.carte)} DT</b></td></tr>`).join("")}</tbody>
        </table></div>` : `<p class="muted">Rien d'encaissé ce jour-là.</p>`}
      </div>
      <div class="panel">
        <h2>Clôture de la journée</h2>
        ${c.unpaid.n ? `<p style="color:var(--ember)">Attention : ${c.unpaid.n} commande(s) pas encore encaissée(s) ou annulée(s) (${fmt(c.unpaid.total)} DT).</p>` : ""}
        ${c.cancelled.n ? `<p class="muted">${c.cancelled.n} commande(s) annulée(s) (${fmt(c.cancelled.total)} DT).</p>` : ""}
        ${c.closing
          ? `<p>✅ Clôturée par <b>${esc(c.closing.closed_by)}</b> le ${new Date(c.closing.created_at).toLocaleString("fr-FR")}
               · total au moment de la clôture : <b>${fmt(c.closing.totals.total)} DT</b></p>`
          : `<button class="btn primary" id="close-day" ${c.unpaid.n ? "disabled" : ""}>Clôturer la journée</button>
             <p class="muted" style="margin-top:8px">La clôture enregistre les totaux du jour (espèces, carte, par serveur).</p>`}
      </div>`;
    $("cash-day").addEventListener("change", e => { cashDay = e.target.value; showCash(); });
    document.querySelectorAll("[data-shift]").forEach(b => b.addEventListener("click", () => {
      cashDay = addDays(cashDay, Number(b.dataset.shift));
      showCash();
    }));
    if ($("close-day")) $("close-day").addEventListener("click", async () => {
      if (!confirm(`Clôturer la journée du ${frDay(c.day)} : ${fmt(c.total)} DT ?`)) return;
      try {
        await api("/api/admin/cash/close", { method: "POST", body: JSON.stringify({ day: c.day }) });
        toast("Journée clôturée");
      } catch (err) { toast(err.message); }
      showCash();
    });
  } catch (err) { toast(err.message); }
}

// =====================================================================
// Rapports
// =====================================================================
let reportRange = null;
function presets() {
  const t = bizToday(), d = new Date(`${t}T12:00:00`);
  const monthStart = isoDay(new Date(d.getFullYear(), d.getMonth(), 1));
  const lastStart = isoDay(new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const lastEnd = isoDay(new Date(d.getFullYear(), d.getMonth(), 0));
  return [
    ["Aujourd'hui", t, t], ["7 jours", addDays(t, -6), t], ["Ce mois", monthStart, t],
    ["Mois dernier", lastStart, lastEnd], ["30 jours", addDays(t, -29), t],
  ];
}

async function showReports() {
  if (!reportRange) reportRange = { from: addDays(bizToday(), -6), to: bizToday() };
  const { from, to } = reportRange;
  $("view").innerHTML = `
    <div class="bo-filters">
      ${presets().map(([l, f, t]) => `<button class="btn small ${f === from && t === to ? "primary" : ""}" data-from="${f}" data-to="${t}">${l}</button>`).join("")}
      <input type="date" id="r-from" value="${from}"> → <input type="date" id="r-to" value="${to}">
      <span class="spacer" style="flex:1"></span>
      <button class="btn primary" id="export">Export Excel</button>
    </div>
    <div id="report"><p class="muted">Chargement…</p></div>`;
  document.querySelectorAll("[data-from]").forEach(b => b.addEventListener("click", () => {
    reportRange = { from: b.dataset.from, to: b.dataset.to };
    showReports();
  }));
  ["r-from", "r-to"].forEach(id => $(id).addEventListener("change", () => {
    reportRange = { from: $("r-from").value, to: $("r-to").value };
    showReports();
  }));
  $("export").addEventListener("click", () => exportCsv(from, to));

  try {
    const r = await api(`/api/admin/reports?from=${from}&to=${to}`);
    // Toutes les journées de la période, même sans vente
    const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) days.push(r.days.find(x => x.day === d) || { day: d, orders: 0, revenue: 0 });
    const maxDay = Math.max(1, ...days.map(d => d.revenue));
    $("report").innerHTML = `
      <div class="kpis">
        <div class="kpi"><span>Chiffre d'affaires</span><b>${fmt(r.revenue)}<i>DT</i></b></div>
        <div class="kpi"><span>Commandes</span><b>${r.orders}</b></div>
        <div class="kpi"><span>Panier moyen</span><b>${fmt(r.orders ? r.revenue / r.orders : 0)}<i>DT</i></b></div>
        <div class="kpi"><span>Clients</span><b>${r.clients}</b></div>
        <div class="kpi"><span>Payé en points</span><b>${fmt(r.discount)}<i>DT</i></b></div>
        <div class="kpi"><span>Annulées</span><b>${r.cancelled}</b></div>
      </div>
      <div class="panel">
        <h2>Chiffre par jour</h2>
        <div class="days-chart">${days.map(d => `<div style="height:${(d.revenue / maxDay) * 100}%"
          title="${frDay(d.day)} : ${fmt(d.revenue)} DT · ${d.orders} cmd"></div>`).join("")}</div>
        <div class="days-axis"><span>${frDay(from)}</span><span>${frDay(to)}</span></div>
      </div>
      <div class="grid2">
        <div class="panel"><h2>Par terrasse</h2>
          ${r.floors.length ? bars(r.floors, f => esc(f.name), f => f.revenue, f => `${fmt(f.revenue)} DT · ${f.orders}`) : `<p class="muted">—</p>`}</div>
        <div class="panel"><h2>Par serveur (encaissé)</h2>
          ${r.staff.length ? bars(r.staff, s => esc(s.name), s => s.revenue, s => `${fmt(s.revenue)} DT · ${s.orders}`) : `<p class="muted">—</p>`}</div>
        <div class="panel"><h2>Moyens de paiement</h2>
          ${r.payments.length ? bars(r.payments, p => esc(p.method), p => p.revenue, p => `${fmt(p.revenue)} DT · ${p.orders}`) : `<p class="muted">—</p>`}</div>
        <div class="panel"><h2>Top produits</h2>
          ${r.top.length ? bars(r.top, p => `${esc(p.icon)} ${esc(p.name)}`, p => p.qty, p => `${p.qty} · ${fmt(p.revenue)} DT`) : `<p class="muted">—</p>`}</div>
      </div>`;
  } catch (err) {
    $("report").innerHTML = `<p class="empty-box">${esc(err.message)}</p>`;
  }
}

async function exportCsv(from, to) {
  try {
    const res = await fetch(`/api/admin/reports.csv?from=${from}&to=${to}`, {
      headers: { Authorization: `Bearer ${getStaffToken()}` },
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Export impossible");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await res.blob());
    a.download = `707-commandes-${from}-au-${to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (err) { toast(err.message); }
}

// =====================================================================
// Menu : catégories, produits, options, photos
// =====================================================================
let menuData = null;
let editing = null;             // produit en cours d'édition (copie) ou null
let onlyMissing = false;        // n'afficher que les produits sans photo
let bulk = [];                  // import de photos en cours : [{ file, url, productId }]

// "Crêpe-Nutella_2.jpg" -> "crepe nutella 2" : pour associer une photo à un produit par son nom de fichier
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, " ").trim();
function guessProduct(fileName, products) {
  const f = norm(fileName);
  const exact = products.find(p => norm(p.name) === f);
  if (exact) return exact.id;
  // Le nom du produit le plus long contenu dans le nom du fichier ("photo express 1" -> Express)
  const inside = products.filter(p => f.includes(norm(p.name))).sort((a, b) => b.name.length - a.name.length);
  if (inside.length) return inside[0].id;
  const around = products.filter(p => norm(p.name).includes(f));
  return around.length === 1 ? around[0].id : null;
}

async function loadMenuData() { menuData = await api("/api/admin/menu"); }

async function showMenu() {
  try { await loadMenuData(); } catch (err) { return toast(err.message); }
  drawMenu();
  const v = $("view");
  v.addEventListener("click", onMenuClick);
  v.addEventListener("change", onMenuChange);
}

function productRow(p) {
  const cat = menuData.categories.find(c => c.key === p.category_key);
  return `
    <div class="prow ${p.archived || p.sold_out || p.stock === 0 ? "off" : ""}" data-pid="${p.id}">
      <label class="pthumb pick ${p.image ? "" : "missing"}" title="${p.image ? "Changer la photo" : "Ajouter une photo"}">
        ${p.image ? `<img src="${esc(p.image)}" alt="">` : `${esc(p.icon)}<i>+</i>`}
        <input type="file" accept="image/*" capture="environment" data-photo="${p.id}" hidden>
      </label>
      <span class="pname"><b>${esc(p.name)}</b>
        <small>${fmt(p.price)} DT${p.subcategory ? " · " + esc(p.subcategory) : ""}${p.groups.length ? ` · ${p.groups.length} groupe(s) d'options` : ""}
          ${p.stock !== null ? ` · stock ${p.stock}` : ""}${p.sold_out ? " · épuisé" : ""}${p.archived ? ` · retiré (${esc(cat ? cat.label : "")})` : ""}</small></span>
      <label class="switch"><input type="checkbox" data-quick="soldOut" ${p.sold_out ? "checked" : ""}> épuisé</label>
      <button class="btn small" data-edit="${p.id}">Modifier</button>
    </div>
    ${editing && editing.id === p.id ? editorHtml() : ""}`;
}

function bulkHtml() {
  if (!bulk.length) return "";
  const choices = menuData.products.filter(p => !p.archived).slice().sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const ready = bulk.filter(b => b.productId).length;
  return `
    <div class="panel bulk" id="bulk">
      <h2>Import de ${bulk.length} photo${bulk.length > 1 ? "s" : ""}</h2>
      <p class="muted">Vérifie le produit de chaque photo. Astuce : nomme les fichiers comme les produits (ex. « Crêpe Nutella.jpg »), ils sont reconnus tout seuls.</p>
      <div class="bulk-grid">
        ${bulk.map((b, i) => `
          <div class="bulk-item ${b.productId ? "" : "unmatched"}">
            <img src="${b.url}" alt="">
            <small>${esc(b.file.name)}</small>
            <select data-bulk="${i}">
              <option value="">— ignorer —</option>
              ${choices.map(p => `<option value="${p.id}" ${p.id === b.productId ? "selected" : ""}>${esc(p.name)}${p.image ? " (a déjà une photo)" : ""}</option>`).join("")}
            </select>
          </div>`).join("")}
      </div>
      <div class="editor-actions">
        <span class="muted" id="bulk-progress"></span>
        <span style="flex:1"></span>
        <button class="btn" data-action="bulk-cancel">Annuler</button>
        <button class="btn primary" data-action="bulk-save" ${ready ? "" : "disabled"}>Enregistrer ${ready} photo${ready > 1 ? "s" : ""}</button>
      </div>
    </div>`;
}

function drawMenu() {
  const live = menuData.products.filter(p => !p.archived);
  const archived = menuData.products.filter(p => p.archived);
  const missing = live.filter(p => !p.image).length;
  const shownIn = (key) => live.filter(p => p.category_key === key && (!onlyMissing || !p.image));
  $("view").innerHTML = `
    <div class="panel no-print">
      <h2>Ajouter</h2>
      <div class="form-row">
        <input id="new-cat" placeholder="Nouvelle catégorie (ex. Burgers)">
        <select id="new-cat-station"><option value="cuisine">Préparée en cuisine</option><option value="bar">Préparée au bar</option></select>
        <button class="btn" data-action="add-cat">+ Catégorie</button>
        <button class="btn primary" data-action="add-product">+ Produit</button>
      </div>
      <div class="form-row" style="margin-top:12px">
        <label class="btn primary">Importer des photos
          <input type="file" id="bulk-photos" accept="image/*" multiple hidden></label>
        <label class="switch"><input type="checkbox" id="only-missing" ${onlyMissing ? "checked" : ""}>
          sans photo seulement</label>
        <span class="muted">${missing ? `${missing} produit${missing > 1 ? "s" : ""} sans photo sur ${live.length}` : "Tous les produits ont une photo"}
          · appuie sur une vignette pour prendre la photo</span>
      </div>
    </div>
    ${bulkHtml()}
    ${editing && !editing.id ? editorHtml() : ""}
    ${menuData.categories.map(c => {
      const items = shownIn(c.key);
      if (onlyMissing && !items.length) return "";
      return `
        <section class="menu-cat" data-cat="${esc(c.key)}">
          <header>
            <h2>${esc(c.label)}</h2>
            <span class="muted">${items.length} produit${items.length > 1 ? "s" : ""}</span>
            <span class="spacer" style="flex:1"></span>
            <input class="cat-label" value="${esc(c.label)}" aria-label="Nom" style="width:140px">
            <select class="cat-station">
              <option value="cuisine" ${c.station === "cuisine" ? "selected" : ""}>Cuisine</option>
              <option value="bar" ${c.station === "bar" ? "selected" : ""}>Bar</option>
            </select>
            <input class="cat-subs" value="${esc(c.subs.join(", "))}" placeholder="Ordre des sous-catégories, séparées par des virgules" style="min-width:240px;flex:1">
            <button class="btn small" data-action="save-cat">Enregistrer</button>
            ${items.length ? "" : `<button class="btn small danger" data-action="del-cat">Supprimer</button>`}
          </header>
          ${items.map(productRow).join("") || `<p class="muted" style="padding:10px 0">Aucun produit.</p>`}
        </section>`;
    }).join("")}
    ${archived.length ? `<section class="menu-cat"><header><h2>Retirés du menu</h2></header>${archived.map(productRow).join("")}</section>` : ""}`;
}

function editorHtml() {
  const p = editing;
  const cats = menuData.categories;
  const subsOf = (key) => [...new Set([...(cats.find(c => c.key === key) || { subs: [] }).subs,
    ...menuData.products.filter(x => x.category_key === key && x.subcategory).map(x => x.subcategory)])];
  return `
    <div class="editor" id="editor">
      <h3>${p.id ? `Modifier · ${esc(p.name)}` : "Nouveau produit"}</h3>
      <div class="fgrid">
        <label>Nom<input data-f="name" value="${esc(p.name)}" maxlength="60"></label>
        <label>Prix (DT)<input data-f="price" type="number" step="0.1" min="0" value="${p.price}"></label>
        <label>Catégorie<select data-f="category_key">
          ${cats.map(c => `<option value="${esc(c.key)}" ${c.key === p.category_key ? "selected" : ""}>${esc(c.label)}</option>`).join("")}
        </select></label>
        <label>Sous-catégorie<input data-f="subcategory" value="${esc(p.subcategory)}" list="subs-list" maxlength="40" placeholder="(aucune)">
          <datalist id="subs-list">${subsOf(p.category_key).map(s => `<option value="${esc(s)}">`).join("")}</datalist></label>
        <label>Description<input data-f="note" value="${esc(p.note)}" maxlength="120"></label>
        <label>Calories<input data-f="kcal" type="number" min="0" value="${p.kcal}"></label>
        <label>Icône (emoji)<input data-f="icon" value="${esc(p.icon)}" maxlength="8"></label>
        <label>Badge<input data-f="badge" value="${esc(p.badge || "")}" list="badges-list" maxlength="30" placeholder="(aucun)">
          <datalist id="badges-list"><option value="Best-seller"><option value="Nouveau"><option value="Signature"><option value="Top 5 de la semaine"></datalist></label>
        <label>Stock (vide = illimité)<input data-f="stock" type="number" min="0" value="${p.stock ?? ""}" placeholder="∞"></label>
        <label>Photo
          <span class="photo-pick">
            <span class="pthumb">${p.image ? `<img src="${esc(p.image)}" alt="">` : esc(p.icon)}</span>
            <input type="file" id="photo-file" accept="image/*">
            ${p.image ? `<button class="btn small" data-action="no-photo">Retirer</button>` : ""}
          </span></label>
        <label class="checks">
          <span class="switch"><input type="checkbox" data-f="favorite" ${p.favorite ? "checked" : ""}> dans « Pour toi »</span>
          <span class="switch"><input type="checkbox" data-f="sold_out" ${p.sold_out ? "checked" : ""}> épuisé</span>
          <span class="switch"><input type="checkbox" data-f="kind" ${p.kind === "pizza" ? "checked" : ""}> pizza dessinée</span>
        </label>
      </div>
      ${p.id ? groupsHtml(p) : `<p class="muted" style="margin-top:12px">Enregistre le produit pour lui ajouter des options (suppléments, sauces, tailles…).</p>`}
      <div class="editor-actions">
        ${p.id ? `<button class="btn ${p.archived ? "" : "danger"}" data-action="archive">${p.archived ? "Remettre au menu" : "Retirer du menu"}</button>` : ""}
        <span style="flex:1"></span>
        <button class="btn" data-action="cancel-edit">Fermer</button>
        <button class="btn primary" data-action="save-product">Enregistrer</button>
      </div>
    </div>`;
}

function groupsHtml(p) {
  return `
    <h3 style="margin-top:16px;font-size:16px">Options</h3>
    ${p.groups.map(g => `
      <div class="og" data-gid="${g.id}">
        <div class="og-head">
          <input type="text" class="g-title" value="${esc(g.title)}" maxlength="40">
          <span class="switch"><input type="checkbox" class="g-single" ${g.single ? "checked" : ""}> un seul choix</span>
          <button class="btn small" data-action="save-group">OK</button>
          <button class="btn small danger" data-action="del-group">Supprimer le groupe</button>
        </div>
        ${g.options.map(o => `
          <div class="orow" data-oid="${esc(o.id)}">
            <input class="n" value="${esc(o.name)}" maxlength="40">
            <input class="num p" type="number" step="0.1" min="0" value="${o.price}" title="Prix +DT">
            <input class="num k" type="number" min="0" value="${o.kcal}" title="kcal">
            <button class="btn small" data-action="save-opt">OK</button>
            <button class="btn small danger" data-action="del-opt">✕</button>
          </div>`).join("")}
        <div class="orow">
          <input class="n new-n" placeholder="Nouvelle option (ex. Fromage)" maxlength="40">
          <input class="num new-p" type="number" step="0.1" min="0" placeholder="+DT">
          <input class="num new-k" type="number" min="0" placeholder="kcal">
          <button class="btn small" data-action="add-opt">+ Ajouter</button>
        </div>
      </div>`).join("")}
    <div class="og"><div class="og-head">
      <input type="text" id="new-group" placeholder="Nouveau groupe (ex. Suppléments, Sauce, Taille)" maxlength="40">
      <span class="switch"><input type="checkbox" id="new-group-single"> un seul choix</span>
      <button class="btn small" data-action="add-group">+ Groupe</button>
    </div></div>`;
}

// Lit les champs de l'éditeur dans `editing`
function readEditor() {
  document.querySelectorAll("#editor [data-f]").forEach(el => {
    const f = el.dataset.f;
    if (f === "favorite" || f === "sold_out") editing[f] = el.checked;
    else if (f === "kind") editing.kind = el.checked ? "pizza" : "simple";
    else editing[f] = el.value;
  });
}

async function act(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
    await loadMenuData();
    if (editing && editing.id) {
      const fresh = menuData.products.find(p => p.id === editing.id);
      editing = fresh ? { ...fresh, ...pick(editing) } : null;
    }
    drawMenu();
  } catch (err) { toast(err.message); }
}
// Champs de l'éditeur non encore enregistrés : on les garde après un rafraîchissement
const pick = (e) => {
  const o = {};
  ["name", "price", "category_key", "subcategory", "note", "kcal", "icon", "badge", "stock", "favorite", "sold_out", "kind",
   "image_id", "image"]
    .forEach(k => { if (e[k] !== undefined) o[k] = e[k]; });
  return o;
};

async function onMenuClick(e) {
  const b = e.target.closest("[data-action], [data-edit]");
  if (!b) return;
  if (b.dataset.edit) {
    const p = menuData.products.find(x => x.id === Number(b.dataset.edit));
    editing = editing && editing.id === p.id ? null : { ...p };
    drawMenu();
    if (editing) $("editor").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const a = b.dataset.action;
  const cat = b.closest("[data-cat]");
  const g = b.closest("[data-gid]"), o = b.closest("[data-oid]");
  const row = b.closest(".orow");
  if (editing && document.getElementById("editor")) readEditor();

  switch (a) {
    case "add-cat":
      return act(() => api("/api/admin/categories", { method: "POST",
        body: JSON.stringify({ label: $("new-cat").value, station: $("new-cat-station").value }) }), "Catégorie ajoutée");
    case "save-cat":
      return act(() => api(`/api/admin/categories/${encodeURIComponent(cat.dataset.cat)}`, { method: "PATCH", body: JSON.stringify({
        label: cat.querySelector(".cat-label").value,
        station: cat.querySelector(".cat-station").value,
        subs: cat.querySelector(".cat-subs").value.split(",").map(s => s.trim()).filter(Boolean),
      }) }), "Catégorie enregistrée");
    case "del-cat":
      if (!confirm("Supprimer cette catégorie vide ?")) return;
      return act(() => api(`/api/admin/categories/${encodeURIComponent(cat.dataset.cat)}`, { method: "DELETE" }), "Catégorie supprimée");
    case "add-product":
      editing = { id: null, name: "", price: 0, category_key: (menuData.categories[0] || {}).key, subcategory: "", note: "",
        kcal: 0, icon: "🍽️", badge: "", stock: null, favorite: false, sold_out: false, kind: "simple", image: null, image_id: null, groups: [] };
      drawMenu();
      return $("editor").scrollIntoView({ behavior: "smooth", block: "center" });
    case "cancel-edit":
      editing = null;
      return drawMenu();
    case "save-product": {
      const body = {
        name: editing.name, price: Number(editing.price), category: editing.category_key, subcategory: editing.subcategory,
        note: editing.note, kcal: Number(editing.kcal) || 0, icon: editing.icon, badge: editing.badge || null,
        stock: editing.stock === "" || editing.stock == null ? null : Number(editing.stock),
        favorite: editing.favorite, soldOut: editing.sold_out, kind: editing.kind, imageId: editing.image_id || null,
      };
      return act(async () => {
        if (editing.id) await api(`/api/admin/products/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
        else {
          const r = await api("/api/admin/products", { method: "POST", body: JSON.stringify(body) });
          editing.id = r.id;   // l'éditeur reste ouvert pour ajouter des options
        }
      }, "Produit enregistré");
    }
    case "archive":
      return act(() => api(`/api/admin/products/${editing.id}`, { method: "PATCH",
        body: JSON.stringify({ archived: !editing.archived }) }), editing.archived ? "Remis au menu" : "Retiré du menu");
    case "no-photo":
      editing.image_id = null;
      editing.image = null;
      return drawMenu();
    case "add-group":
      return act(() => api(`/api/admin/products/${editing.id}/groups`, { method: "POST",
        body: JSON.stringify({ title: $("new-group").value, single: $("new-group-single").checked }) }), "Groupe ajouté");
    case "save-group":
      return act(() => api(`/api/admin/groups/${g.dataset.gid}`, { method: "PATCH", body: JSON.stringify({
        title: g.querySelector(".g-title").value, single: g.querySelector(".g-single").checked }) }), "Groupe enregistré");
    case "del-group":
      if (!confirm("Supprimer ce groupe et ses options ?")) return;
      return act(() => api(`/api/admin/groups/${g.dataset.gid}`, { method: "DELETE" }), "Groupe supprimé");
    case "add-opt":
      return act(() => api(`/api/admin/groups/${g.dataset.gid}/options`, { method: "POST", body: JSON.stringify({
        name: row.querySelector(".new-n").value, price: Number(row.querySelector(".new-p").value) || 0,
        kcal: Number(row.querySelector(".new-k").value) || 0 }) }), "Option ajoutée");
    case "save-opt":
      return act(() => api(`/api/admin/options/${encodeURIComponent(o.dataset.oid)}`, { method: "PATCH", body: JSON.stringify({
        name: o.querySelector(".n").value, price: Number(o.querySelector(".p").value) || 0,
        kcal: Number(o.querySelector(".k").value) || 0 }) }), "Option enregistrée");
    case "del-opt":
      return act(() => api(`/api/admin/options/${encodeURIComponent(o.dataset.oid)}`, { method: "DELETE" }), "Option supprimée");
    case "bulk-cancel":
      clearBulk();
      return drawMenu();
    case "bulk-save":
      return saveBulk(b);
  }
}

function clearBulk() {
  bulk.forEach(x => URL.revokeObjectURL(x.url));
  bulk = [];
}

// Envoie les photos une par une (réduites dans le navigateur) et les attache aux produits
async function saveBulk(btn) {
  const todo = bulk.filter(x => x.productId);
  btn.disabled = true;
  let done = 0, failed = 0;
  for (const x of todo) {
    $("bulk-progress").textContent = `Envoi ${done + failed + 1} / ${todo.length}…`;
    try {
      await setPhoto(x.productId, x.file);
      done++;
    } catch { failed++; }
  }
  clearBulk();
  await loadMenuData();
  drawMenu();
  toast(failed ? `${done} photo(s) enregistrée(s), ${failed} en échec` : `${done} photo(s) enregistrée(s)`);
}

async function setPhoto(productId, file) {
  const dataUrl = await shrinkImage(file);
  const img = await api("/api/admin/images", { method: "POST", body: JSON.stringify({ dataUrl }) });
  await api(`/api/admin/products/${productId}`, { method: "PATCH", body: JSON.stringify({ imageId: img.id }) });
}

async function onMenuChange(e) {
  const t = e.target;
  // Import en masse : on propose un produit pour chaque fichier
  if (t.id === "bulk-photos" && t.files.length) {
    clearBulk();
    const products = menuData.products.filter(p => !p.archived);
    bulk = [...t.files].filter(f => f.type.startsWith("image/"))
      .map(file => ({ file, url: URL.createObjectURL(file), productId: guessProduct(file.name, products) }));
    drawMenu();
    return $("bulk").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (t.dataset.bulk !== undefined) {
    bulk[Number(t.dataset.bulk)].productId = t.value ? Number(t.value) : null;
    const scroll = window.scrollY;
    drawMenu();
    return window.scrollTo(0, scroll);
  }
  if (t.id === "only-missing") { onlyMissing = t.checked; return drawMenu(); }
  // Photo d'un produit depuis la liste (sur téléphone : ouvre l'appareil photo)
  if (t.dataset.photo && t.files[0]) {
    toast("Envoi de la photo…");
    return act(() => setPhoto(Number(t.dataset.photo), t.files[0]), "Photo enregistrée");
  }
  // Épuisé en un clic depuis la liste
  const quick = e.target.closest("[data-quick]");
  if (quick) {
    const id = quick.closest("[data-pid]").dataset.pid;
    return act(() => api(`/api/admin/products/${id}`, { method: "PATCH", body: JSON.stringify({ soldOut: quick.checked }) }),
      quick.checked ? "Marqué épuisé" : "De nouveau disponible");
  }
  if (e.target.id === "photo-file" && e.target.files[0]) {
    readEditor();
    try {
      toast("Envoi de la photo…");
      const dataUrl = await shrinkImage(e.target.files[0]);
      const r = await api("/api/admin/images", { method: "POST", body: JSON.stringify({ dataUrl }) });
      editing.image_id = r.id;
      editing.image = r.url;
      drawMenu();
      toast("Photo prête · pense à enregistrer");
    } catch (err) { toast(err.message); }
  }
  if (e.target.dataset.f === "category_key") { readEditor(); drawMenu(); }
}

// Réduit la photo dans le navigateur (800 px, JPEG) avant l'envoi
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 800 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => reject(new Error("Image illisible"));
    img.src = URL.createObjectURL(file);
  });
}

// =====================================================================
// Terrasses, tables et QR codes
// =====================================================================
let qrFloor = null;
async function showFloors() {
  let list;
  try { list = await api("/api/admin/floors"); } catch (err) { return toast(err.message); }
  floors = list.map(f => ({ id: f.id, name: f.name }));
  if (!list.some(f => f.id === qrFloor)) qrFloor = list[0] && list[0].id;
  const qf = list.find(f => f.id === qrFloor);
  const tables = qf ? Array.from({ length: qf.table_to - qf.table_from + 1 }, (_, i) => qf.table_from + i) : [];
  $("view").innerHTML = `
    <div class="panel no-print">
      <h2>Terrasses et numéros de table</h2>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Nom</th><th>Première table</th><th>Dernière table</th><th>Serveurs</th><th></th></tr></thead>
        <tbody>
          ${list.map(f => `
            <tr data-fid="${f.id}">
              <td><input class="f-name" value="${esc(f.name)}" maxlength="40"></td>
              <td><input class="num f-from" type="number" min="1" max="999" value="${f.table_from}"></td>
              <td><input class="num f-to" type="number" min="1" max="999" value="${f.table_to}"></td>
              <td class="muted">${f.staff}</td>
              <td><button class="btn small" data-action="save-floor">Enregistrer</button>
                  <button class="btn small danger" data-action="del-floor">✕</button></td>
            </tr>`).join("")}
          <tr>
            <td><input id="nf-name" placeholder="Nouvelle terrasse" maxlength="40"></td>
            <td><input id="nf-from" class="num" type="number" min="1" max="999" placeholder="ex. 46"></td>
            <td><input id="nf-to" class="num" type="number" min="1" max="999" placeholder="ex. 60"></td>
            <td></td>
            <td><button class="btn small primary" data-action="add-floor">+ Ajouter</button></td>
          </tr>
        </tbody>
      </table></div>
      <p class="muted" style="margin-top:8px">Chaque numéro de table n'appartient qu'à une terrasse. Le client ne peut commander que sur une table qui existe.</p>
    </div>
    <div class="bo-filters no-print">
      <select id="qr-floor">${list.map(f => `<option value="${f.id}" ${f.id === qrFloor ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select>
      <span class="muted">${tables.length} QR codes · un par table, à coller sur la table</span>
      <span style="flex:1"></span>
      <button class="btn primary" data-action="print">Imprimer</button>
    </div>
    <div class="qr-grid">
      ${tables.map(t => `
        <div class="qr-card">
          <img src="/api/qr.svg?floor=${qf.id}&table=${t}" alt="QR table ${t}" loading="lazy">
          <b>Table ${t}</b>
          <small>707 · ${esc(qf.name)} · scanne pour commander</small>
        </div>`).join("")}
    </div>`;

  const v = $("view");
  $("qr-floor").addEventListener("change", e => { qrFloor = Number(e.target.value); showFloors(); });
  v.addEventListener("click", async e => {
    const b = e.target.closest("[data-action]");
    if (!b) return;
    const tr = b.closest("[data-fid]");
    const run = async (fn, msg) => {
      try { await fn(); toast(msg); showFloors(); } catch (err) { toast(err.message); }
    };
    switch (b.dataset.action) {
      case "print": return window.print();
      case "add-floor":
        return run(() => api("/api/admin/floors", { method: "POST", body: JSON.stringify({
          name: $("nf-name").value, tableFrom: Number($("nf-from").value), tableTo: Number($("nf-to").value) }) }), "Terrasse ajoutée");
      case "save-floor":
        return run(() => api(`/api/admin/floors/${tr.dataset.fid}`, { method: "PATCH", body: JSON.stringify({
          name: tr.querySelector(".f-name").value, tableFrom: Number(tr.querySelector(".f-from").value),
          tableTo: Number(tr.querySelector(".f-to").value) }) }), "Terrasse enregistrée");
      case "del-floor":
        if (!confirm("Supprimer cette terrasse ?")) return;
        return run(() => api(`/api/admin/floors/${tr.dataset.fid}`, { method: "DELETE" }), "Terrasse supprimée");
    }
  });
}

// =====================================================================
// Équipe
// =====================================================================
async function showTeam() {
  const list = await api("/api/admin/staff").catch(err => { toast(err.message); return []; });
  const floorSelect = (attrs, sel) => `
    <select ${attrs}>${floors.map(f => `<option value="${f.id}" ${f.id === sel ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select>`;
  const roleSelect = (attrs, sel) => `
    <select ${attrs}>${Object.entries(ROLE_LABEL).map(([k, l]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  $("view").innerHTML = `
    <div class="panel">
      <h2>Ajouter un compte</h2>
      <form class="form-row" id="new-staff">
        <input id="n-name" placeholder="Nom (ex. Ahmed)" required>
        <input id="n-user" placeholder="Identifiant (ex. ahmed)" autocapitalize="none" required>
        <input id="n-pass" type="text" placeholder="Mot de passe (6+)" required>
        ${roleSelect('id="n-role"', "serveur")}
        ${floorSelect('id="n-floor"', floors[0] && floors[0].id)}
        <button class="btn primary">Créer</button>
      </form>
      <p class="muted" style="margin-top:8px">Serveur : une terrasse, il ne voit qu'elle. Cuisine / Bar : l'écran de préparation. Chef de terrain : les réservations. Admin : tout.</p>
    </div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Nom</th><th>Identifiant</th><th>Rôle</th><th>Terrasse</th><th>Actif</th><th>Mot de passe</th></tr></thead>
      <tbody>
        ${list.map(s => `
          <tr data-id="${s.id}" class="${s.active ? "" : "off"}">
            <td>${esc(s.name)}</td>
            <td class="muted">${esc(s.username)}</td>
            <td>${s.id === me.id ? "Admin (toi)" : roleSelect('data-field="role"', s.role)}</td>
            <td>${s.role === "serveur" ? floorSelect('data-field="floorId"', s.floor_id) : `<span class="muted">—</span>`}</td>
            <td><label class="switch"><input type="checkbox" data-field="active" ${s.active ? "checked" : ""} ${s.id === me.id ? "disabled" : ""}> actif</label></td>
            <td><button class="btn small" data-reset>Changer</button></td>
          </tr>`).join("")}
      </tbody>
    </table></div>`;

  $("n-role").addEventListener("change", e => { $("n-floor").hidden = e.target.value !== "serveur"; });
  $("new-staff").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await api("/api/admin/staff", { method: "POST", body: JSON.stringify({
        name: $("n-name").value, username: $("n-user").value.trim().toLowerCase(), password: $("n-pass").value,
        role: $("n-role").value, floorId: Number($("n-floor").value) }) });
      toast("Compte créé");
      showTeam();
    } catch (err) { toast(err.message); }
  });

  const patch = async (id, body, msg) => {
    try { await api(`/api/admin/staff/${id}`, { method: "PATCH", body: JSON.stringify(body) }); toast(msg); }
    catch (err) { toast(err.message); }
    showTeam();
  };
  const tbody = $("view").querySelector("tbody");
  tbody.addEventListener("change", e => {
    const input = e.target.closest("[data-field]");
    if (!input) return;
    const id = input.closest("[data-id]").dataset.id;
    const f = input.dataset.field;
    if (f === "floorId") patch(id, { floorId: Number(input.value) }, "Terrasse changée");
    if (f === "active") patch(id, { active: input.checked }, input.checked ? "Compte activé" : "Compte désactivé");
    if (f === "role") {
      const body = { role: input.value };
      if (input.value === "serveur") body.floorId = floors[0] && floors[0].id;
      patch(id, body, `Rôle : ${ROLE_LABEL[input.value]}`);
    }
  });
  tbody.addEventListener("click", e => {
    if (!e.target.closest("[data-reset]")) return;
    const password = prompt("Nouveau mot de passe (6 caractères minimum) :");
    if (password) patch(e.target.closest("[data-id]").dataset.id, { password }, "Mot de passe changé");
  });
}

startStaffPage({
  title: "Espace admin",
  subtitle: "Réservé au gérant du 707.",
  async onReady(staff) {
    if (staff.role !== "admin") {
      $("app").innerHTML = `
        <div class="login">
          <img src="logo707.png" alt="707">
          <h1>Accès réservé</h1>
          <p>Ce compte n'est pas un compte admin.</p>
          <a class="order-btn" style="display:grid;place-items:center;text-decoration:none"
             href="${staff.role === "serveur" ? "serveur.html" : staff.role === "terrain" ? "terrain.html" : "cuisine.html"}">Aller à mon espace</a>
          <button class="btn" style="margin-top:10px" id="out">Changer de compte</button>
        </div>`;
      return $("out").addEventListener("click", staffLogout);
    }
    me = staff;
    floors = (await api("/api/menu")).floors;
    renderShell();
    show();
  },
});
