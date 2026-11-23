// Réservation des terrains de foot.
// Le client demande un créneau ; il ne devient pris qu'après confirmation du chef de terrain (par téléphone).
const express = require("express");
const pool = require("../db/pool");
const { HttpError, wrap, toDT } = require("../lib/http");
const { requireClient, requireStaff } = require("../lib/auth");
const { TZ } = require("../lib/day");
const push = require("../lib/push");

const router = express.Router();
const DAYS_AHEAD = 30;
const MAX_PENDING = 3;           // demandes en attente par client
const LOCAL_NOW = `(now() AT TIME ZONE '${TZ}')`;
const IS_FUTURE = `(r.day + r.hour * interval '1 hour') > ${LOCAL_NOW}`;

const addDay = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const windowDays = (today) => Array.from({ length: DAYS_AHEAD }, (_, i) => addDay(today, i));
const isPast = (now, day, hour) => day < now.day || (day === now.day && hour <= now.hour);
const hoursOf = (p) => Array.from({ length: p.close_hour - p.open_hour }, (_, i) => p.open_hour + i);
const validDay = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};
// « 23/11 à 21 h » pour les notifications
const slotLabel = (day, hour) => `${day.slice(8, 10)}/${day.slice(5, 7)} à ${hour % 24} h`;
const idOf = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) throw new HttpError(404, "Introuvable");
  return n;
};

async function nowLocal(db = pool) {
  const { rows } = await db.query(
    `SELECT to_char(n, 'YYYY-MM-DD') AS day, extract(hour FROM n)::int AS hour FROM (SELECT ${LOCAL_NOW} AS n) t`);
  return rows[0];
}
async function pitchOf(id, db = pool) {
  const { rows } = await db.query("SELECT id, name, open_hour, close_hour, price_mil FROM pitches WHERE id = $1", [idOf(id)]);
  if (!rows.length) throw new HttpError(404, "Terrain introuvable");
  return rows[0];
}
const pitchJson = (p) => ({ id: p.id, name: p.name, openHour: p.open_hour, closeHour: p.close_hour, price: p.price_mil === null ? null : toDT(p.price_mil) });

// ---- Public : terrains, calendrier, créneaux (jamais le nom ni le numéro d'un client) ----
router.get("/pitches", wrap(async (req, res) => {
  const now = await nowLocal();
  const [{ rows: pitches }, { rows: taken }] = await Promise.all([
    pool.query("SELECT id, name, open_hour, close_hour, price_mil FROM pitches ORDER BY position, id"),
    pool.query("SELECT pitch_id, hour FROM reservations WHERE day = $1 AND status = 'confirmee'", [now.day]),
  ]);
  res.json({
    today: now.day,
    pitches: pitches.map(p => ({
      ...pitchJson(p),
      freeToday: hoursOf(p).filter(h => !isPast(now, now.day, h) && !taken.some(t => t.pitch_id === p.id && t.hour === h)).length,
    })),
  });
}));

router.get("/pitches/:id/calendar", wrap(async (req, res) => {
  const p = await pitchOf(req.params.id);
  const now = await nowLocal();
  const days = windowDays(now.day);
  const { rows } = await pool.query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, hour FROM reservations
      WHERE pitch_id = $1 AND status = 'confirmee' AND day BETWEEN $2 AND $3`, [p.id, days[0], days[days.length - 1]]);
  res.json({
    today: now.day,
    days: days.map(day => ({
      day,
      free: hoursOf(p).filter(h => !isPast(now, day, h) && !rows.some(r => r.day === day && r.hour === h)).length,
    })),
  });
}));

router.get("/pitches/:id/slots", wrap(async (req, res) => {
  const p = await pitchOf(req.params.id);
  const { day } = req.query;
  if (!validDay(day)) throw new HttpError(400, "Date invalide");
  const now = await nowLocal();
  const { rows } = await pool.query(
    "SELECT hour FROM reservations WHERE pitch_id = $1 AND day = $2 AND status = 'confirmee'", [p.id, day]);
  const taken = new Set(rows.map(r => r.hour));
  res.set("Cache-Control", "no-store");
  res.json({
    day,
    slots: hoursOf(p).map(hour => ({ hour, state: taken.has(hour) ? "reserve" : isPast(now, day, hour) ? "passe" : "libre" })),
  });
}));

// ---- Client ----
router.get("/client/reservations", requireClient, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.pitch_id AS "pitchId", p.name AS pitch, to_char(r.day, 'YYYY-MM-DD') AS day, r.hour, r.status,
            (r.price_mil::float8 / 1000) AS price
       FROM reservations r JOIN pitches p ON p.id = r.pitch_id
      WHERE r.client_id = $1 AND (r.status <> 'annulee' OR r.handled_by IS NOT NULL) AND ${IS_FUTURE}
      ORDER BY r.day, r.hour LIMIT 30`, [req.client.id]);
  res.json(rows);
}));

router.post("/client/reservations", requireClient, wrap(async (req, res) => {
  const { pitchId, day, hour } = req.body || {};
  if (!validDay(day) || !Number.isInteger(hour)) throw new HttpError(400, "Créneau invalide");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT id FROM clients WHERE id = $1 FOR UPDATE", [req.client.id]);   // une demande à la fois par client
    const p = await pitchOf(pitchId, db);
    const now = await nowLocal(db);
    if (!windowDays(now.day).includes(day)) throw new HttpError(400, `Réservation possible sur ${DAYS_AHEAD} jours`);
    if (!hoursOf(p).includes(hour)) throw new HttpError(400, "Ce terrain est fermé à cette heure");
    if (isPast(now, day, hour)) throw new HttpError(400, "Ce créneau est déjà passé");

    const { rows: taken } = await db.query(
      "SELECT 1 FROM reservations WHERE pitch_id = $1 AND day = $2 AND hour = $3 AND status = 'confirmee'", [p.id, day, hour]);
    if (taken.length) throw new HttpError(409, "Ce créneau vient d'être réservé");
    const { rows: [{ n }] } = await db.query(
      `SELECT count(*)::int AS n FROM reservations r WHERE r.client_id = $1 AND r.status = 'en_attente' AND ${IS_FUTURE}`, [req.client.id]);
    if (n >= MAX_PENDING) throw new HttpError(429, `Tu as déjà ${MAX_PENDING} demandes en attente`);

    const { rows: [r] } = await db.query(
      `INSERT INTO reservations (pitch_id, client_id, day, hour, price_mil) VALUES ($1, $2, $3, $4, $5) RETURNING id, status`,
      [p.id, req.client.id, day, hour, p.price_mil]);
    await db.query("COMMIT");
    await push.toStaff({ roles: ["terrain"] }, {
      title: `Demande · ${p.name}`, body: `${req.client.name} (${req.client.phone}) · ${slotLabel(day, hour)}`, tag: `resa-${r.id}`,
    });
    res.status(201).json({ ...r, phone: req.client.phone });
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    if (err.code === "23505") throw new HttpError(409, "Tu as déjà demandé ce créneau");
    throw err;
  } finally {
    db.release();
  }
}));

// ---- Chef de terrain et admin ----
router.use("/terrain", requireStaff("terrain", "admin"));

const STAFF_ROW = `
  SELECT r.id, r.pitch_id AS "pitchId", p.name AS pitch, to_char(r.day, 'YYYY-MM-DD') AS day, r.hour, r.status,
         (r.price_mil::float8 / 1000) AS price, r.created_at AS "createdAt", r.handled_at AS "handledAt", c.name AS client, c.phone, s.name AS "handledBy"
    FROM reservations r
    JOIN pitches p ON p.id = r.pitch_id
    JOIN clients c ON c.id = r.client_id
    LEFT JOIN staff s ON s.id = r.handled_by`;

router.get("/terrain/board", wrap(async (req, res) => {
  const now = await nowLocal();
  const day = req.query.day || now.day;
  if (!validDay(day)) throw new HttpError(400, "Date invalide");
  const [pitches, pending, matches, history] = await Promise.all([
    pool.query("SELECT id, name, open_hour, close_hour, price_mil FROM pitches ORDER BY position, id"),
    pool.query(`${STAFF_ROW} WHERE r.status = 'en_attente' AND ${IS_FUTURE} ORDER BY r.day, r.hour, r.created_at LIMIT 100`),
    pool.query(`${STAFF_ROW} WHERE r.status = 'confirmee' AND r.day = $1 ORDER BY r.hour`, [day]),
    pool.query(`${STAFF_ROW} WHERE r.status <> 'en_attente' ORDER BY COALESCE(r.handled_at, r.created_at) DESC LIMIT 15`),
  ]);
  res.set("Cache-Control", "no-store");
  res.json({ canCancel: req.staff.role === "terrain", now, day, pitches: pitches.rows.map(pitchJson), pending: pending.rows, matches: matches.rows, history: history.rows });
}));

router.patch("/terrain/reservations/:id", wrap(async (req, res) => {
  const id = idOf(req.params.id);
  const { status } = req.body || {};
  // L'annulation d'un match est réservée au chef de terrain (ni le client, ni l'admin)
  if (status === "annulee" && req.staff.role !== "terrain") throw new HttpError(403, "Seul le chef de terrain peut annuler");
  const ALLOWED = { en_attente: ["confirmee", "refusee"], confirmee: ["annulee"] };
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const { rows: [r] } = await db.query(
      `SELECT r.id, r.pitch_id, r.client_id, to_char(r.day, 'YYYY-MM-DD') AS day_text, r.day, r.hour, r.status, ${IS_FUTURE} AS future
         FROM reservations r WHERE r.id = $1 FOR UPDATE`, [id]);
    if (!r) throw new HttpError(404, "Réservation introuvable");
    if (!(ALLOWED[r.status] || []).includes(status)) throw new HttpError(409, "Cette réservation a déjà été traitée");
    if (status === "confirmee" && !r.future) throw new HttpError(409, "Ce créneau est déjà passé");

    await db.query("UPDATE reservations SET status = $1, handled_by = $2, handled_at = now() WHERE id = $3", [status, req.staff.id, id]);
    let autoRefused = 0, refusedClients = [];
    if (status === "confirmee") {
      // Le créneau est pris : les autres demandes sur la même heure tombent
      const other = await db.query(
        `UPDATE reservations SET status = 'refusee', handled_by = $1, handled_at = now()
          WHERE pitch_id = $2 AND day = $3 AND hour = $4 AND status = 'en_attente' AND id <> $5 RETURNING id, client_id`,
        [req.staff.id, r.pitch_id, r.day, r.hour, id]);
      autoRefused = other.rowCount;
      refusedClients = other.rows;
    }
    await db.query("COMMIT");
    const { rows: [pitch] } = await pool.query("SELECT name FROM pitches WHERE id = $1", [r.pitch_id]);
    const slot = `${pitch ? pitch.name : "Terrain"} · ${slotLabel(r.day_text, r.hour)}`;
    const RESA_MSG = {
      confirmee: { title: "Match confirmé", body: `${slot}. À bientôt au 707 Club !` },
      refusee: { title: "Créneau non disponible", body: `${slot} : ta demande n'a pas pu être acceptée.` },
      annulee: { title: "Match annulé", body: `${slot} a été annulé par le 707 Club.` },
    };
    await Promise.all([
      push.toClient(r.client_id, { ...RESA_MSG[status], tag: `resa-${id}` }),
      ...refusedClients.map(x => push.toClient(x.client_id, { ...RESA_MSG.refusee, tag: `resa-${x.id}` })),
    ]);
    res.json({ id, status, autoRefused });
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    if (err.code === "23505") throw new HttpError(409, "Ce créneau est déjà confirmé pour un autre client");
    throw err;
  } finally {
    db.release();
  }
}));

module.exports = router;
