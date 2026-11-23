// Code commun aux espaces serveur et admin : connexion, appels API, cartes de commande.

const STAFF_TOKEN = "707-staff-token";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n) => Number(n).toFixed(1).replace(".", ",");

const getStaffToken = () => { try { return localStorage.getItem(STAFF_TOKEN); } catch { return null; } };
const setStaffToken = (t) => { try { t ? localStorage.setItem(STAFF_TOKEN, t) : localStorage.removeItem(STAFF_TOKEN); } catch {} };

async function api(url, options = {}) {
  const token = getStaffToken();
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) {
    setStaffToken(null);
    location.reload();          // session expirée : retour à l'écran de connexion
  }
  if (!res.ok) throw new Error(data.error || "Connexion impossible");
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

// ---- Connexion ----
// Affiche le formulaire dans #app, appelle onReady(staff) une fois connecté.
async function startStaffPage({ title, subtitle, onReady: ready }) {
  const onReady = (staff) => { staffPush(staff); return ready(staff); };
  if (getStaffToken()) {
    try { return onReady(await api("/api/staff/me")); } catch { /* jeton invalide : formulaire */ }
  }
  $("app").innerHTML = `
    <form class="login" id="login-form">
      <img src="logo707.png" alt="707">
      <h1>${esc(title)}</h1>
      <p>${esc(subtitle)}</p>
      <input class="search" id="login-user" placeholder="Identifiant" autocomplete="username" autocapitalize="none" required>
      <input class="search" id="login-pass" type="password" placeholder="Mot de passe" autocomplete="current-password" required>
      <p class="form-error" id="login-error"></p>
      <button class="order-btn" type="submit">Se connecter</button>
    </form>`;
  $("login-user").focus();
  $("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    WebPush.ask();   // pendant le geste : obligatoire sur iPhone
    try {
      const res = await api("/api/staff/login", {
        method: "POST",
        body: JSON.stringify({ username: $("login-user").value, password: $("login-pass").value }),
      });
      setStaffToken(res.token);
      onReady(res.staff);
    } catch (err) {
      $("login-error").textContent = err.message;
      $("login-pass").value = "";
      $("login-pass").focus();
    }
  });
}

// ---- Notifications sur l'écran du téléphone (même page fermée) ----
// Autorisé : abonnement silencieux. Pas encore demandé : un bandeau avec un bouton.
async function staffPush(staff) {
  if (staff.role === "admin") return;   // l'admin ne reçoit pas de notifications
  if (WebPush.permission() === "granted" && WebPush.supported() && !WebPush.needsInstall()) {
    WebPush.subscribe("staff", getStaffToken());
    return;
  }
  const canAsk = WebPush.supported() && !WebPush.needsInstall() && WebPush.permission() === "default";
  const text = canAsk ? "Reçois les commandes et les appels sur ton téléphone, même page fermée." : WebPush.hint();
  if (!text || document.getElementById("push-banner")) return;
  try { if (sessionStorage.getItem("707-push-later")) return; } catch {}
  const bar = document.createElement("div");
  bar.className = "push-banner";
  bar.id = "push-banner";
  bar.innerHTML = `<span>${esc(text)}</span>
    ${canAsk ? `<button class="push-yes" id="push-yes">Activer les notifications</button>` : ""}
    <button class="push-later" id="push-later" aria-label="Plus tard">×</button>`;
  document.body.appendChild(bar);
  $("push-later").addEventListener("click", () => {
    bar.remove();
    try { sessionStorage.setItem("707-push-later", "1"); } catch {}
  });
  if (canAsk) $("push-yes").addEventListener("click", async () => {
    const p = await WebPush.ask();
    bar.remove();
    if (p === "granted" && await WebPush.subscribe("staff", getStaffToken())) toast("Notifications activées");
    else toast(p === "granted" ? "Activation impossible, réessaie" : "Notifications refusées");
  });
}

async function staffLogout() {
  await WebPush.unsubscribe();
  await api("/api/staff/logout", { method: "POST" }).catch(() => {});
  setStaffToken(null);
  location.reload();
}

// ---- Commandes ----
const STATUS_LABEL = {
  nouvelle: "Nouvelle", en_preparation: "En préparation", servie: "Servie", payee: "Payée", annulee: "Annulée",
};
// Bouton principal pour faire avancer la commande (l'encaissement a ses deux boutons)
const NEXT_ACTION = {
  nouvelle: { status: "en_preparation", label: "Prendre en charge" },
  en_preparation: { status: "servie", label: "Servie" },
};
const CAN_CANCEL = ["nouvelle", "en_preparation"];

function timeAgo(date) {
  const min = Math.round((Date.now() - new Date(date)) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  return new Date(date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

const optionsText = (i) => (i.options && i.options.length ? i.options.map(x => esc(x.name)).join(", ") : "");

function orderCard(o, { showFloor = false, isNew = false } = {}) {
  const next = NEXT_ACTION[o.status];
  const kitchenReady = o.ready && ["nouvelle", "en_preparation"].includes(o.status);
  return `
    <article class="ocard ${isNew ? "is-new" : ""} ${kitchenReady ? "is-ready" : ""}" data-order="${o.id}">
      <div class="ocard-top">
        <span class="ocard-table">Table ${esc(o.table_no)}</span>
        ${showFloor ? `<span class="muted">${esc(o.floor_name)}</span>` : ""}
        <span class="spacer"></span>
        ${kitchenReady ? `<span class="status s-servie">Prête à servir</span>` : ""}
        <span class="status s-${o.status}">${STATUS_LABEL[o.status] || o.status}</span>
      </div>
      <div class="ocard-meta">N°${o.id} · ${timeAgo(o.created_at)} · ${esc(o.client_name || "Client")}</div>
      <ul>
        ${(o.items || []).map(i => `
          <li><span class="it"><b>${i.qty}×</b> ${esc(i.name)} ${i.ready ? `<span class="tick">✓</span>` : ""}
              <i class="leader"></i>${fmt(i.unit * i.qty)}</span>
            ${optionsText(i) ? `<small>+ ${optionsText(i)}</small>` : ""}
          </li>`).join("")}
      </ul>
      <div class="ocard-foot">
        <span class="total">${fmt(o.total)} DT</span>
        <span class="pay">${esc(o.paid_method || o.payment || "À encaisser")}${o.discount ? ` · −${fmt(o.discount)} en points` : ""}</span>
        <span class="spacer"></span>
        <button class="btn small" data-ticket>Ticket</button>
      </div>
      ${o.status === "payee" ? `<div class="ocard-meta">Encaissée par ${esc(o.paid_by || "—")}</div>` : ""}
      ${next || CAN_CANCEL.includes(o.status) || o.status === "servie" ? `
      <div class="ocard-actions">
        ${CAN_CANCEL.includes(o.status) ? `<button class="btn danger" data-set="annulee">Annuler</button>` : ""}
        ${next ? `<button class="btn primary" data-set="${next.status}">${next.label}</button>` : ""}
        ${o.status === "servie" ? `
          <button class="btn primary" data-set="payee" data-method="Espèces">Encaisser espèces</button>
          <button class="btn primary" data-set="payee" data-method="Carte">Encaisser carte</button>` : ""}
      </div>` : ""}
    </article>`;
}

// Ticket imprimable (imprimante du téléphone, ou PDF)
function printTicket(o) {
  const w = window.open("", "_blank", "width=380,height=640");
  if (!w) return toast("Autorise les fenêtres pour imprimer le ticket");
  const date = new Date(o.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Ticket n°${o.id}</title>
    <style>
      body { font: 13px/1.4 ui-monospace, Menlo, Consolas, monospace; width: 72mm; margin: 0 auto; padding: 8px; color: #000; }
      h1 { font-size: 16px; text-align: center; margin: 0; } p { text-align: center; margin: 4px 0 10px; }
      table { width: 100%; border-collapse: collapse; } td { padding: 2px 0; vertical-align: top; }
      td:last-child { text-align: right; white-space: nowrap; } small { color: #444; }
      .t td { border-top: 1px dashed #000; font-weight: bold; font-size: 15px; padding-top: 6px; }
      @media print { button { display: none; } }
    </style></head><body>
    <h1>707 Café & Resto</h1>
    <p>Ticket n°${o.id}<br>${date}<br>${esc(o.floor_name)} · Table ${esc(o.table_no)}</p>
    <table>
      ${(o.items || []).map(i => `<tr><td>${i.qty}× ${esc(i.name)}${optionsText(i) ? `<br><small>+ ${optionsText(i)}</small>` : ""}</td><td>${fmt(i.unit * i.qty)}</td></tr>`).join("")}
      ${o.discount ? `<tr><td>Sous-total</td><td>${fmt(o.subtotal)}</td></tr><tr><td>Points (${o.points_used})</td><td>-${fmt(o.discount)}</td></tr>` : ""}
      <tr class="t"><td>TOTAL DT</td><td>${fmt(o.total)}</td></tr>
    </table>
    <p>${o.status === "payee" ? esc(o.paid_method || o.payment) + " · payé<br>" : ""}Merci et à bientôt !</p>
    <button onclick="print()">Imprimer</button>
    <script>setTimeout(() => print(), 300)<\/script>
  </body></html>`);
  w.document.close();
}

// Clic sur une carte : changer le statut (PATCH) ou imprimer le ticket. getOrder(id) rend la commande affichée.
function bindOrderActions(container, onDone, getOrder) {
  container.addEventListener("click", async e => {
    const card = e.target.closest("[data-order]");
    if (!card) return;
    const id = card.dataset.order;
    if (e.target.closest("[data-ticket]")) {
      const o = getOrder && getOrder(Number(id));
      return o && printTicket(o);
    }
    const btn = e.target.closest("[data-set]");
    if (!btn) return;
    const status = btn.dataset.set, method = btn.dataset.method;
    if (status === "annulee" && !confirm(`Annuler la commande n°${id} ?`)) return;
    btn.disabled = true;
    try {
      await api(`/api/staff/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status, method }) });
      toast(`N°${id} · ${STATUS_LABEL[status]}${method ? " · " + method : ""}`);
    } catch (err) {
      toast(err.message);
    }
    onDone();
  });
}

// Petit bip pour une nouvelle commande (après un premier geste sur la page, exigé par les navigateurs)
let audioCtx = null;
document.addEventListener("pointerdown", () => {
  if (!audioCtx) { try { audioCtx = new AudioContext(); } catch {} }
}, { once: true });
function ding() {
  if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  if (!audioCtx) return;
  [0, 0.18].forEach(t => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.2, audioCtx.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + t + 0.15);
    o.connect(g).connect(audioCtx.destination);
    o.start(audioCtx.currentTime + t);
    o.stop(audioCtx.currentTime + t + 0.16);
  });
}

// Safari (iPhone) ignore user-scalable=no : on bloque le pincement ici
["gesturestart", "gesturechange"].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
