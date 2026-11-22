// Écran cuisine / bar : ce qu'il reste à préparer, la plus ancienne commande d'abord.
// Compte "cuisine" ou "bar" : sa station. Admin : choix de la station (?station=bar).

let me = null;
let station = "cuisine";
let known = null;
const LATE_MIN = 15;            // au-delà, la carte passe en rouge

function renderShell() {
  const pick = me.role === "admin";
  $("app").innerHTML = `
    <header class="bo-head">
      <img src="logo707.png" alt="707">
      <div><h1 id="title"></h1><p>${esc(me.name)} · <span id="count">…</span></p></div>
      <span class="spacer"></span>
      ${pick ? `
        <button class="btn ${station === "cuisine" ? "primary" : ""}" data-station="cuisine">Cuisine</button>
        <button class="btn ${station === "bar" ? "primary" : ""}" data-station="bar">Bar</button>` : ""}
      <button class="btn" id="logout">Sortir</button>
    </header>
    <section class="orders" id="orders" style="margin-top:16px"></section>`;
  $("logout").addEventListener("click", staffLogout);
  document.querySelectorAll("[data-station]").forEach(b => b.addEventListener("click", () => {
    station = b.dataset.station;
    known = null;
    renderShell();
    load();
  }));
  $("orders").addEventListener("click", async e => {
    const b = e.target.closest("[data-ready]");
    if (!b) return;
    b.disabled = true;
    try {
      const r = await api(`/api/kitchen/orders/${b.dataset.ready}/ready${me.role === "admin" ? `?station=${station}` : ""}`, { method: "POST" });
      toast(r.orderReady ? `N°${r.id} complète · le serveur est prévenu` : `N°${r.id} · ${station} prêt`);
    } catch (err) { toast(err.message); }
    load();
  });
}

async function load() {
  try {
    const q = me.role === "admin" ? `?station=${station}` : "";
    const { station: st, orders } = await api(`/api/kitchen/orders${q}`);
    station = st;
    $("title").textContent = st === "bar" ? "Bar" : "Cuisine";
    $("count").textContent = `${orders.length} commande${orders.length > 1 ? "s" : ""} à préparer`;
    document.title = orders.length ? `(${orders.length}) 707 · ${st}` : `707 · ${st}`;

    if (known && orders.some(o => !known.has(o.id))) { ding(); toast("Nouvelle commande"); }
    known = new Set(orders.map(o => o.id));

    $("orders").innerHTML = orders.length ? orders.map(o => {
      const late = (Date.now() - new Date(o.created_at)) / 60000 > LATE_MIN;
      return `
        <article class="ocard ${late ? "late" : ""}">
          <div class="ocard-top">
            <span class="ocard-table">Table ${esc(o.table_no)}</span>
            <span class="muted">${esc(o.floor_name)}</span>
            <span class="spacer"></span>
            <span class="muted">N°${o.id}</span>
          </div>
          <div class="ocard-meta">${timeAgo(o.created_at)}${late ? " · en retard" : ""}</div>
          <ul>
            ${o.items.map(i => `
              <li><b>${i.qty}×</b> ${esc(i.name)}
                ${optionsText(i) ? `<small>+ ${optionsText(i)}</small>` : ""}</li>`).join("")}
          </ul>
          <div class="ocard-actions"><button class="btn primary" data-ready="${o.id}">Prêt ✓</button></div>
        </article>`;
    }).join("") : `<p class="empty-box">Rien à préparer.</p>`;
  } catch (err) {
    toast(err.message);
  }
}

startStaffPage({
  title: "Cuisine / Bar",
  subtitle: "Connecte-toi avec le compte cuisine ou bar.",
  onReady(staff) {
    if (staff.role === "serveur") return location.replace("serveur.html");
    me = staff;
    if (me.role === "admin") station = new URLSearchParams(location.search).get("station") === "bar" ? "bar" : "cuisine";
    renderShell();
    load();
    setInterval(load, 5000);
  },
});
