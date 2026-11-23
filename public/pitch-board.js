// Tableau des terrains, commun au chef de terrain et à l'admin.
// mountPitchBoard(el) affiche le tableau et renvoie la fonction qui le recharge.

function mountPitchBoard(root) {
  let day = null;
  let knownPending = null;
  const hourText = (h) => `${h}h – ${h + 1 === 24 ? "00" : h + 1}h`;
  const dayText = (s) => new Date(`${s}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const shortDay = (s) => new Date(`${s}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });
  const phoneText = (p) => String(p).replace(/(\d{2})(\d{3})(\d{3})/, "$1 $2 $3");
  const priceText = (n) => (n ? `${String(Number(Number(n).toFixed(3))).replace(".", ",")} DT` : "");
  const shift = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const HISTORY = { confirmee: "Confirmé", refusee: "Refusé", annulee: "Annulé" };

  root.innerHTML = `<div class="pb"><div id="pb-body"><p class="muted">Chargement…</p></div></div>`;

  function pendingCard(r, all) {
    const same = all.filter(x => x.pitchId === r.pitchId && x.day === r.day && x.hour === r.hour).length;
    return `
      <article class="pb-req">
        <div class="pb-req-top"><b>${esc(r.pitch)}</b><span>${esc(shortDay(r.day))} · ${hourText(r.hour)}</span></div>
        <p>${esc(r.client)}${r.price ? `<strong class="pb-price">${priceText(r.price)}</strong>` : ""}${same > 1 ? `<em>${same} demandes sur ce créneau</em>` : ""}</p>
        <a class="pb-call" href="tel:+216${esc(r.phone)}">Appeler ${esc(phoneText(r.phone))}</a>
        <div class="pb-req-act">
          <button class="btn danger" data-pb-set="refusee" data-id="${r.id}">Refuser</button>
          <button class="btn primary" data-pb-set="confirmee" data-id="${r.id}">Confirmer le match</button>
        </div>
      </article>`;
  }

  function grid(d) {
    const from = Math.min(...d.pitches.map(p => p.openHour));
    const to = Math.max(...d.pitches.map(p => p.closeHour));
    const rows = [];
    for (let h = from; h < to; h++) {
      const past = d.day < d.now.day || (d.day === d.now.day && h <= d.now.hour);
      const cells = d.pitches.map(p => {
        if (h < p.openHour || h >= p.closeHour) return `<td class="c-none">—</td>`;
        const m = d.matches.find(x => x.pitchId === p.id && x.hour === h);
        if (m) return `<td class="c-match"><b>${esc(m.client)}</b><a href="tel:+216${esc(m.phone)}">${esc(phoneText(m.phone))}</a>${m.price ? `<small>${priceText(m.price)}</small>` : ""}
          ${past || !d.canCancel ? "" : `<button data-pb-set="annulee" data-id="${m.id}">Annuler</button>`}</td>`;
        if (past) return `<td class="c-past">Passé</td>`;
        const n = d.pending.filter(x => x.pitchId === p.id && x.day === d.day && x.hour === h).length;
        return n ? `<td class="c-wait">${n} en attente</td>` : `<td class="c-free">Libre</td>`;
      }).join("");
      rows.push(`<tr><th>${hourText(h)}</th>${cells}</tr>`);
    }
    return `<div class="tbl-wrap"><table class="pb-grid"><thead><tr><th>Heure</th>${d.pitches.map(p => `<th>${esc(p.name)}</th>`).join("")}</tr></thead>
      <tbody>${rows.join("")}</tbody></table></div>`;
  }

  async function draw() {
    // Ne pas refermer le calendrier pendant que le chef choisit une date
    if (document.activeElement && document.activeElement.id === "pb-date") return;
    try {
      const d = await api(`/api/terrain/board${day ? `?day=${day}` : ""}`);
      day = d.day;
      const ids = new Set(d.pending.map(r => r.id));
      if (knownPending && d.pending.some(r => !knownPending.has(r.id))) { ding(); toast("Nouvelle demande de terrain"); }
      knownPending = ids;
      const body = root.querySelector("#pb-body");
      if (!body) return;
      body.innerHTML = `
        <section class="panel">
          <h2>À confirmer ${d.pending.length ? `<span class="pb-count">${d.pending.length}</span>` : ""}</h2>
          ${d.pending.length ? `<div class="pb-reqs">${d.pending.map(r => pendingCard(r, d.pending)).join("")}</div>`
            : `<p class="muted">Aucune demande en attente.</p>`}
        </section>
        <section class="panel">
          <div class="pb-day">
            <button class="btn" data-pb-day="-1" aria-label="Jour précédent">‹</button>
            <h2>${esc(dayText(d.day))}</h2>
            <button class="btn" data-pb-day="1" aria-label="Jour suivant">›</button>
            <input type="date" id="pb-date" value="${d.day}" aria-label="Choisir une date">
            ${d.day === d.now.day ? "" : `<button class="btn" data-pb-today>Aujourd'hui</button>`}
          </div>
          ${grid(d)}
        </section>
        <section class="panel">
          <h2>Dernières actions</h2>
          ${d.history.length ? `<ul class="pb-history">${d.history.map(r => `
            <li><b class="h-${r.status}">${HISTORY[r.status]}</b>
              <span>${esc(r.pitch)} · ${esc(shortDay(r.day))} · ${hourText(r.hour)}</span>
              <span>${esc(r.client)} · ${esc(phoneText(r.phone))}${r.price ? ` · ${priceText(r.price)}` : ""}</span>
              <small>${r.handledBy ? `par ${esc(r.handledBy)}` : "par le client"}</small></li>`).join("")}</ul>`
            : `<p class="muted">Rien pour le moment.</p>`}
        </section>`;
    } catch (err) { toast(err.message); }
  }

  root.addEventListener("click", async e => {
    const move = e.target.closest("[data-pb-day]");
    if (move) { day = shift(day, Number(move.dataset.pbDay)); return draw(); }
    if (e.target.closest("[data-pb-today]")) { day = null; return draw(); }
    const b = e.target.closest("[data-pb-set]");
    if (!b) return;
    const status = b.dataset.pbSet;
    if (status === "annulee" && !confirm("Annuler ce match ? Le créneau redevient libre.")) return;
    if (status === "refusee" && !confirm("Refuser cette demande ?")) return;
    b.disabled = true;
    try {
      const r = await api(`/api/terrain/reservations/${b.dataset.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      toast(status === "confirmee"
        ? `Match confirmé${r.autoRefused ? `, ${r.autoRefused} autre${r.autoRefused > 1 ? "s" : ""} demande${r.autoRefused > 1 ? "s" : ""} refusée${r.autoRefused > 1 ? "s" : ""}` : ""}`
        : status === "refusee" ? "Demande refusée" : "Match annulé, créneau libre");
    } catch (err) { toast(err.message); }
    draw();
  });
  root.addEventListener("change", e => {
    if (e.target.id === "pb-date" && e.target.value) { day = e.target.value; e.target.blur(); draw(); }
  });

  draw();
  return draw;
}
