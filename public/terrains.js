// Client : réservation d'un terrain de foot (3 terrains en 3D, calendrier, créneaux).
// Un créneau ne s'éteint qu'après confirmation du chef de terrain.

const PITCH = { pitches: [], today: "", pitch: null, days: [], month: "", day: "", slots: [], sel: null, mine: [], timer: null, sending: false };
const pitchStatus = new Map();   // pour prévenir le client quand le chef répond

const hourLabel = (h) => `${h}h – ${h + 1 === 24 ? "00" : h + 1}h`;
const longDay = (s) => new Date(`${s}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const monthLabel = (m) => new Date(`${m}-15T12:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
const pitchPrice = (n) => (n === null || n === undefined ? "" : `${String(Number(Number(n).toFixed(3))).replace(".", ",")} DT`);
const phoneLabel = (p) => String(p || "").replace(/(\d{2})(\d{3})(\d{3})/, "$1 $2 $3");

// Terrain dessiné en 3D (CSS) : gazon, lignes, murs, buts, projecteurs
function pitch3d(n) {
  return `
    <div class="p3d" aria-hidden="true"><div class="p3d-scene">
      <div class="p3d-floor">
        <svg viewBox="0 0 220 130"><g fill="none" stroke="#fff" stroke-width="1.5" opacity=".92">
          <rect x="6" y="6" width="208" height="118"/><path d="M110 6v118"/><circle cx="110" cy="65" r="17"/>
          <rect x="6" y="34" width="30" height="62"/><rect x="184" y="34" width="30" height="62"/></g>
          <circle cx="110" cy="65" r="1.8" fill="#fff"/>
          <text x="73" y="81" text-anchor="middle" font-size="44" font-weight="600" fill="#fff" opacity=".88">${n}</text>
        </svg>
      </div>
      <i class="p3d-wall back"></i><i class="p3d-wall left"></i><i class="p3d-wall right near"></i><i class="p3d-wall front near"></i>
      <i class="p3d-goal g-left"></i><i class="p3d-goal g-right"></i>
      <i class="p3d-pole a"></i><i class="p3d-pole b"></i><i class="p3d-pole c"></i><i class="p3d-pole d"></i>
    </div></div>`;
}

const backIcon = `<svg class="i" viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>`;

async function openPitches() {
  $("pitch-page").hidden = false;
  document.body.classList.add("pitch-open");
  PITCH.pitch = null;
  $("pitch-page").innerHTML = `<p class="pz-loading">Chargement des terrains…</p>`;
  await refreshPitchList();
  clearInterval(PITCH.timer);
  PITCH.timer = setInterval(refreshPitchPage, 10000);
}
function closePitches() {
  clearInterval(PITCH.timer);
  $("pitch-page").hidden = true;
  document.body.classList.remove("pitch-open");
}

async function loadMine() {
  if (!CLIENT) { PITCH.mine = []; pitchStatus.clear(); return; }
  try {
    PITCH.mine = await api("/api/client/reservations");
    PITCH.mine.forEach(r => {
      const was = pitchStatus.get(r.id);
      if (was === "en_attente" && r.status === "confirmee") toast(`Match confirmé : ${r.pitch}, ${hourLabel(r.hour)}`);
      if (was === "en_attente" && r.status === "refusee") toast(`Créneau non confirmé : ${r.pitch}, ${hourLabel(r.hour)}`);
      if (was === "confirmee" && r.status === "annulee") toast(`Match annulé par le chef : ${r.pitch}, ${hourLabel(r.hour)}`);
      pitchStatus.set(r.id, r.status);
    });
  } catch {}
}

async function refreshPitchList() {
  try {
    const [d] = await Promise.all([api("/api/pitches"), loadMine()]);
    PITCH.pitches = d.pitches;
    PITCH.today = d.today;
    drawPitchList();
  } catch (err) {
    $("pitch-page").innerHTML = `<div class="pz-head"><button class="pz-back" data-pz="close" aria-label="Retour">${backIcon}</button></div>
      <p class="pz-loading">${esc(err.message)}</p>`;
  }
}
async function refreshPitchPage() {
  if (document.hidden || $("pitch-page").hidden) return;
  if (PITCH.pitch) { await Promise.all([loadMine(), loadPitchDay()]); drawPitchBody(); }
  else await refreshPitchList();
}

function mineHtml() {
  if (!PITCH.mine.length) return "";
  const label = { en_attente: "Attend l'appel du chef", confirmee: "Match confirmé", refusee: "Non confirmé", annulee: "Annulé par le chef" };
  return `
    <section class="pz-mine"><h2>Mes réservations</h2>
      <p class="pz-note">Pour annuler, contacte le chef de terrain.</p>
      ${PITCH.mine.map(r => `
        <article class="pz-res ${r.status}">
          <div><b>${esc(r.pitch)} · ${hourLabel(r.hour)}</b><small>${esc(longDay(r.day))}${r.price ? ` · ${pitchPrice(r.price)}` : ""}</small>
            <span class="pz-tag">${label[r.status]}</span></div>
        </article>`).join("")}
    </section>`;
}

function drawPitchList() {
  $("pitch-page").innerHTML = `
    <div class="pz-head">
      <button class="pz-back" data-pz="close" aria-label="Retour">${backIcon}</button>
      <div><small>707 Club</small><h1>Réserve ton terrain</h1></div>
    </div>
    <p class="pz-intro">Choisis un terrain pour voir ses horaires.</p>
    <div class="pz-list">
      ${PITCH.pitches.map((p, i) => `
        <button class="pz-card" data-pz-open="${p.id}">
          ${pitch3d(i + 1)}
          <span class="pz-card-foot">
            <span><b>${esc(p.name)}</b>${p.price ? `<i class="pz-price">${pitchPrice(p.price)} / heure</i>` : ""}<small>${p.freeToday ? `${p.freeToday} créneau${p.freeToday > 1 ? "x" : ""} libre${p.freeToday > 1 ? "s" : ""} aujourd'hui` : "Complet aujourd'hui"}</small></span>
            <em>Voir les horaires</em>
          </span>
        </button>`).join("")}
    </div>
    ${mineHtml()}`;
}

async function loadPitchDay() {
  const [cal, s] = await Promise.all([
    api(`/api/pitches/${PITCH.pitch.id}/calendar`),
    api(`/api/pitches/${PITCH.pitch.id}/slots?day=${PITCH.day}`),
  ]);
  PITCH.days = cal.days;
  PITCH.slots = s.slots;
  if (PITCH.sel !== null && (s.slots.find(x => x.hour === PITCH.sel) || {}).state !== "libre") PITCH.sel = null;
}

async function openPitch(id) {
  const p = PITCH.pitches.find(x => x.id === id);
  if (!p) return;
  PITCH.pitch = p;
  PITCH.sel = null;
  try {
    const cal = await api(`/api/pitches/${id}/calendar`);
    PITCH.days = cal.days;
    PITCH.day = (cal.days.find(d => d.free > 0) || cal.days[0]).day;
    PITCH.month = PITCH.day.slice(0, 7);
    await loadPitchDay();
    const n = PITCH.pitches.indexOf(p) + 1;
    $("pitch-page").innerHTML = `
      <div class="pz-head">
        <button class="pz-back" data-pz="list" aria-label="Retour aux terrains">${backIcon}</button>
        <div><small>707 Club${p.price ? ` · ${pitchPrice(p.price)} / heure` : ""}</small><h1>${esc(p.name)}</h1></div>
      </div>
      <div class="pz-hero">${pitch3d(n)}</div>
      <div id="pz-body"></div>`;
    $("pitch-page").scrollTop = 0;
    drawPitchBody();
  } catch (err) { toast(err.message); PITCH.pitch = null; }
}

function calendarHtml() {
  const [y, m] = PITCH.month.split("-").map(Number);
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const count = new Date(y, m, 0).getDate();
  const byDay = new Map(PITCH.days.map(d => [d.day, d]));
  const months = [...new Set(PITCH.days.map(d => d.day.slice(0, 7)))];
  const at = months.indexOf(PITCH.month);
  let cells = "<span></span>".repeat(offset);
  for (let i = 1; i <= count; i++) {
    const key = `${PITCH.month}-${String(i).padStart(2, "0")}`;
    const d = byDay.get(key);
    const cls = !d ? "out" : d.free === 0 ? "full" : "free";
    cells += `<button class="${cls} ${key === PITCH.day ? "sel" : ""} ${key === PITCH.days[0].day ? "today" : ""}"
      ${d ? `data-pz-day="${key}"` : "disabled"} aria-label="${esc(longDay(key))}${d ? (d.free ? `, ${d.free} créneaux libres` : ", complet") : ""}">${i}</button>`;
  }
  return `
    <section class="pz-cal">
      <div class="pz-cal-head">
        <button data-pz-month="${months[at - 1] || ""}" ${at > 0 ? "" : "disabled"} aria-label="Mois précédent">‹</button>
        <b>${esc(monthLabel(PITCH.month))}</b>
        <button data-pz-month="${months[at + 1] || ""}" ${at < months.length - 1 ? "" : "disabled"} aria-label="Mois suivant">›</button>
      </div>
      <div class="pz-week">${["L", "M", "M", "J", "V", "S", "D"].map(x => `<span>${x}</span>`).join("")}</div>
      <div class="pz-days">${cells}</div>
    </section>`;
}

function slotHtml(s) {
  const mine = PITCH.mine.find(r => r.pitchId === PITCH.pitch.id && r.day === PITCH.day && r.hour === s.hour && !["refusee", "annulee"].includes(r.status));
  if (mine && mine.status === "confirmee") return `<button class="pz-slot is-mine" disabled><b>${hourLabel(s.hour)}</b><small>Ton match</small></button>`;
  if (s.state === "reserve") return `<button class="pz-slot is-off" disabled><b>${hourLabel(s.hour)}</b><small>Réservé</small></button>`;
  if (s.state === "passe") return `<button class="pz-slot is-past" disabled><b>${hourLabel(s.hour)}</b><small>Passé</small></button>`;
  if (mine) return `<button class="pz-slot is-wait" disabled><b>${hourLabel(s.hour)}</b><small>En attente</small></button>`;
  return `<button class="pz-slot ${PITCH.sel === s.hour ? "sel" : ""}" data-pz-hour="${s.hour}" aria-pressed="${PITCH.sel === s.hour}"><b>${hourLabel(s.hour)}</b><small>Libre</small></button>`;
}

function drawPitchBody() {
  const body = $("pz-body");
  if (!body) return;
  body.innerHTML = `
    ${calendarHtml()}
    <section class="pz-times">
      <h2>${esc(longDay(PITCH.day))}</h2>
      <div class="pz-legend"><span class="l-free">Libre</span><span class="l-wait">En attente</span><span class="l-off">Réservé</span></div>
      <div class="pz-slots">${PITCH.slots.map(slotHtml).join("")}</div>
    </section>
    ${mineHtml()}
    <div class="pz-action" ${PITCH.sel === null ? "hidden" : ""}>
      <span><small>${esc(PITCH.pitch.name)} · ${esc(longDay(PITCH.day))}</small><b>${PITCH.sel === null ? "" : hourLabel(PITCH.sel)}${PITCH.pitch.price ? ` · ${pitchPrice(PITCH.pitch.price)}` : ""}</b></span>
      <button id="pz-send" ${PITCH.sending ? "disabled" : ""}>${PITCH.sending ? "Envoi…" : "Réserver"}</button>
    </div>`;
}

async function sendPitchRequest() {
  if (PITCH.sel === null || PITCH.sending) return;
  if (!CLIENT) return openLogin(sendPitchRequest);
  PITCH.sending = true;
  drawPitchBody();
  try {
    const r = await api("/api/client/reservations", { method: "POST",
      body: JSON.stringify({ pitchId: PITCH.pitch.id, day: PITCH.day, hour: PITCH.sel }) });
    PITCH.sel = null;
    toast(`Demande envoyée. Le chef va t'appeler au ${phoneLabel(r.phone)}`);
  } catch (err) {
    if (err.status === 401) { store.set(TOKEN_KEY, null); CLIENT = null; PITCH.sending = false; return openLogin(sendPitchRequest); }
    toast(err.message);
  }
  PITCH.sending = false;
  await Promise.all([loadMine(), loadPitchDay().catch(() => {})]);
  drawPitchBody();
}

$("pitch-cta").addEventListener("click", openPitches);
$("pitch-page").addEventListener("click", async e => {
  const t = (sel) => e.target.closest(sel);
  const nav = t("[data-pz]");
  if (nav) {
    if (nav.dataset.pz === "close") return closePitches();
    PITCH.pitch = null;
    await refreshPitchList();
    $("pitch-page").scrollTop = 0;
    return;
  }
  const open = t("[data-pz-open]");
  if (open) return openPitch(Number(open.dataset.pzOpen));
  const month = t("[data-pz-month]");
  if (month && month.dataset.pzMonth) { PITCH.month = month.dataset.pzMonth; return drawPitchBody(); }
  const day = t("[data-pz-day]");
  if (day) {
    PITCH.day = day.dataset.pzDay;
    PITCH.sel = null;
    try { await loadPitchDay(); } catch (err) { toast(err.message); }
    return drawPitchBody();
  }
  const hour = t("[data-pz-hour]");
  if (hour) {
    const h = Number(hour.dataset.pzHour);
    PITCH.sel = PITCH.sel === h ? null : h;
    return drawPitchBody();
  }
  if (t("#pz-send")) return sendPitchRequest();
});

// Même hors de la page terrains, le client est prévenu quand le chef répond
setInterval(() => { if (CLIENT && !document.hidden && $("pitch-page").hidden) loadMine(); }, 20000);
