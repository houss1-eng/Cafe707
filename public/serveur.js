// Espace serveur : les commandes et appels de SA terrasse uniquement (le serveur Node filtre).

let me = null;
let scope = "active";           // "active" (en cours) | "done" (terminées aujourd'hui)
let known = null;               // commandes déjà vues, pour repérer les nouvelles
let knownCalls = null;
let readySeen = new Set();      // commandes déjà signalées "prêtes"
let fresh = new Set();
let shown = [];                 // commandes affichées (pour le ticket)

function renderShell() {
  $("app").innerHTML = `
    <header class="bo-head">
      <img src="logo707.png" alt="707">
      <div>
        <h1>${esc(me.floorName || "Toutes les terrasses")}</h1>
        <p>${esc(me.name)} · <span id="my-cash">…</span></p>
      </div>
      <span class="spacer"></span>
      ${me.role === "admin" ? `<a class="btn" href="admin.html">Admin</a>` : ""}
      <button class="btn" id="logout">Sortir</button>
    </header>
    <section class="calls" id="calls"></section>
    <nav class="bo-tabs">
      <button data-scope="active" class="${scope === "active" ? "on" : ""}">En cours<span class="count" id="count-active" hidden></span></button>
      <button data-scope="done" class="${scope === "done" ? "on" : ""}">Terminées aujourd'hui</button>
    </nav>
    <section class="orders" id="orders"></section>`;
  $("logout").addEventListener("click", staffLogout);
  document.querySelector(".bo-tabs").addEventListener("click", e => {
    const b = e.target.closest("[data-scope]");
    if (!b) return;
    scope = b.dataset.scope;
    document.querySelectorAll(".bo-tabs button").forEach(x => x.classList.toggle("on", x === b));
    load();
  });
  bindOrderActions($("orders"), load, id => shown.find(o => o.id === id));
  $("calls").addEventListener("click", async e => {
    const b = e.target.closest("[data-call]");
    if (!b) return;
    b.disabled = true;
    try { await api(`/api/staff/calls/${b.dataset.call}`, { method: "PATCH" }); } catch (err) { toast(err.message); }
    load();
  });
}

async function load() {
  try {
    const [active, calls, cash] = await Promise.all([
      api("/api/staff/orders?scope=active"),
      api("/api/staff/calls"),
      api("/api/staff/cash/me"),
    ]);
    let alert = "";

    // Au premier chargement, on note l'existant sans sonner
    const firstLoad = !known;

    // Commandes que la cuisine / le bar viennent de terminer
    const newlyReady = active.filter(o => o.ready && ["nouvelle", "en_preparation"].includes(o.status) && !readySeen.has(o.id));
    newlyReady.forEach(o => readySeen.add(o.id));
    if (!firstLoad && newlyReady.length) alert = `Prête à servir · Table ${newlyReady[0].table_no}`;

    // Nouvelles commandes (prioritaires sur le message "prête")
    if (!firstLoad) {
      const added = active.filter(o => !known.has(o.id) && o.status === "nouvelle");
      added.forEach(o => fresh.add(o.id));
      if (added.length) alert = added.length > 1 ? `${added.length} nouvelles commandes` : `Nouvelle commande · Table ${added[0].table_no}`;
    }
    known = new Set(active.map(o => o.id));

    // Appels des tables
    if (knownCalls) {
      const newCalls = calls.filter(c => !knownCalls.has(c.id));
      if (newCalls.length) alert = `${newCalls[0].kind === "addition" ? "Addition" : "Appel"} · Table ${newCalls[0].table_no}`;
    }
    knownCalls = new Set(calls.map(c => c.id));
    if (alert) { ding(); toast(alert); }

    $("calls").innerHTML = calls.map(c => `
      <div class="call ${c.kind}">
        <span class="call-ico">${c.kind === "addition" ? "Addition" : "Appel"}</span>
        <div><b>Table ${esc(c.table_no)}</b> · ${c.kind === "addition" ? `addition${c.payment ? " · " + esc(c.payment) : ""}` : "appelle le serveur"}
          <small>${esc(c.client_name || "")} · ${timeAgo(c.created_at)}${me.role === "admin" ? " · " + esc(c.floor_name) : ""}</small></div>
        <button class="btn primary" data-call="${c.id}">J'y vais</button>
      </div>`).join("");

    $("my-cash").textContent = `encaissé aujourd'hui ${fmt(cash.especes + cash.carte)} DT (espèces ${fmt(cash.especes)} · carte ${fmt(cash.carte)})`;

    const count = active.filter(o => o.status === "nouvelle").length + calls.length;
    $("count-active").hidden = !count;
    $("count-active").textContent = count;
    document.title = count ? `(${count}) 707 · Serveur` : "707 · Espace serveur";

    shown = scope === "active" ? active.slice().reverse() : await api("/api/staff/orders?scope=done");
    $("orders").innerHTML = shown.length
      ? shown.map(o => orderCard(o, { showFloor: me.role === "admin", isNew: fresh.has(o.id) })).join("")
      : `<p class="empty-box">${scope === "active" ? "Aucune commande en cours sur ta terrasse." : "Rien de terminé aujourd'hui."}</p>`;
    setTimeout(() => fresh.clear(), 4000);
  } catch (err) {
    toast(err.message);
  }
}

startStaffPage({
  title: "Espace serveur",
  subtitle: "Connecte-toi pour voir les commandes de ta terrasse.",
  onReady(staff) {
    if (staff.role === "cuisine" || staff.role === "bar") return location.replace("cuisine.html");
    me = staff;
    renderShell();
    load();
    setInterval(load, 5000);
  },
});
