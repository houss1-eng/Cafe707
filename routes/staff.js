const express = require("express");
const pool = require("../db/pool");
const { HttpError, wrap } = require("../lib/http");
const auth = require("../lib/auth");
const { NEXT, listOrders } = require("../lib/orders");
const { bizDay, TODAY } = require("../lib/day");

const router = express.Router();
const floorStaff = auth.requireStaff("serveur", "admin");
const kitchenStaff = auth.requireStaff("cuisine", "bar", "admin");

// ---- Connexion serveur / cuisine / bar / admin ----
router.post("/staff/login", wrap(async (req, res) => {
  auth.checkLoginRate(req);
  const username = String((req.body || {}).username || "").trim().toLowerCase();
  const password = String((req.body || {}).password || "");
  const { rows: [s] } = await pool.query(
    `SELECT s.id, s.name, s.role, s.floor_id, s.password_hash, s.active, f.name AS floor_name
       FROM staff s LEFT JOIN floors f ON f.id = s.floor_id WHERE s.username = $1`, [username]);
  if (!s || !s.active || !auth.verifyPassword(password, s.password_hash)) {
    auth.recordLoginFailure(req);
    throw new HttpError(401, "Identifiant ou mot de passe incorrect");
  }
  auth.clearLoginFailures(req);
  const token = await auth.createSession("staff", s.id);
  res.json({ token, staff: { id: s.id, name: s.name, role: s.role, floorId: s.floor_id, floorName: s.floor_name } });
}));

router.post("/staff/logout", wrap(async (req, res) => {
  await auth.deleteSession(req);
  res.json({ ok: true });
}));

router.get("/staff/me", auth.requireStaff(), (req, res) => {
  const s = req.staff;
  res.json({ id: s.id, name: s.name, role: s.role, floorId: s.floor_id, floorName: s.floor_name });
});

// Serveur : uniquement sa terrasse (imposé ici, quoi que demande l'app). Admin : tout, ou une terrasse.
function scopeFloor(req) {
  if (req.staff.role === "serveur") return req.staff.floor_id;
  const f = Number(req.query.floor);
  return Number.isInteger(f) && f > 0 ? f : null;
}
const canTouchFloor = (req, floorId) => req.staff.role === "admin" || floorId === req.staff.floor_id;

// ---- Commandes de la terrasse ----
router.get("/staff/orders", floorStaff, wrap(async (req, res) => {
  const scope = ["active", "done", "today"].includes(req.query.scope) ? req.query.scope : "active";
  res.json(await listOrders({ floorId: scopeFloor(req), scope }));
}));

// Changer le statut. Pour "payee" : method = Espèces | Carte (moyen réellement encaissé).
router.patch("/staff/orders/:id", floorStaff, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { status, method } = req.body || {};
  if (!Number.isInteger(id)) throw new HttpError(400, "Commande invalide");
  if (method != null && !["Espèces", "Carte"].includes(method)) throw new HttpError(400, "Moyen de paiement invalide");

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const { rows: [o] } = await db.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [id]);
    // Une commande d'une autre terrasse est "introuvable" pour ce serveur
    if (!o || !canTouchFloor(req, o.floor_id)) throw new HttpError(404, "Commande introuvable");
    if (!(NEXT[o.status] || []).includes(status)) throw new HttpError(409, "Changement de statut impossible");

    if (status === "annulee") {
      // Annulation : on rend le stock, on rend les points dépensés et on retire les points gagnés
      const { rows: items } = await db.query("SELECT product_id, qty FROM order_items WHERE order_id = $1", [id]);
      for (const it of items) {
        await db.query("UPDATE products SET stock = stock + $2 WHERE id = $1 AND stock IS NOT NULL", [it.product_id, it.qty]);
      }
      if (o.client_id) {
        await db.query("UPDATE clients SET points = GREATEST(points - $2 + $3, 0) WHERE id = $1",
          [o.client_id, o.points_earned, o.points_used]);
      }
    }
    if (status === "payee") {
      if (!method && !o.payment) throw new HttpError(400, "Choisis Espèces ou Carte");
      await db.query(
        "UPDATE orders SET paid_by = $2, paid_method = $3, paid_at = now() WHERE id = $1",
        [id, req.staff.id, method || o.payment]);
    }
    await db.query(
      "UPDATE orders SET status = $2, handled_by = COALESCE(handled_by, $3), updated_at = now() WHERE id = $1",
      [id, status, req.staff.id]);
    await db.query("COMMIT");
    res.json({ id, status });
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}));

// ---- Appels des tables (serveur / addition) ----
router.get("/staff/calls", floorStaff, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ca.id, ca.floor_id, f.name AS floor_name, ca.table_no, ca.kind, ca.payment, ca.created_at,
            c.name AS client_name
       FROM calls ca JOIN floors f ON f.id = ca.floor_id LEFT JOIN clients c ON c.id = ca.client_id
      WHERE ca.status = 'ouvert' AND ($1::int IS NULL OR ca.floor_id = $1)
      ORDER BY ca.created_at`, [scopeFloor(req)]);
  res.json(rows);
}));

router.patch("/staff/calls/:id", floorStaff, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { rows: [c] } = await pool.query("SELECT floor_id, status FROM calls WHERE id = $1", [id]);
  if (!c || !canTouchFloor(req, c.floor_id)) throw new HttpError(404, "Appel introuvable");
  await pool.query(
    "UPDATE calls SET status = 'traite', handled_by = $2, handled_at = now() WHERE id = $1 AND status = 'ouvert'",
    [id, req.staff.id]);
  res.json({ id, status: "traite" });
}));

// ---- Ma caisse du jour (serveur) ----
router.get("/staff/cash/me", floorStaff, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT paid_method AS method, count(*)::int AS n, COALESCE(sum(total), 0)::float AS total
       FROM orders WHERE paid_by = $1 AND status = 'payee' AND ${bizDay("paid_at")} = ${TODAY}
      GROUP BY paid_method`, [req.staff.id]);
  const by = Object.fromEntries(rows.map(r => [r.method, r.total]));
  res.json({ especes: by["Espèces"] || 0, carte: by["Carte"] || 0, count: rows.reduce((n, r) => n + r.n, 0) });
}));

// ---- Écran cuisine / bar ----
// Cuisine et bar voient seulement leurs lignes ; l'admin choisit la station (?station=bar).
function stationOf(req) {
  if (req.staff.role === "cuisine" || req.staff.role === "bar") return req.staff.role;
  return req.query.station === "bar" ? "bar" : "cuisine";
}

router.get("/kitchen/orders", kitchenStaff, wrap(async (req, res) => {
  const station = stationOf(req);
  const { rows } = await pool.query(
    `SELECT o.id, o.table_no, f.name AS floor_name, o.created_at, o.status,
            json_agg(json_build_object('name', p.name, 'icon', p.icon, 'qty', oi.qty, 'options', oi.options)
                     ORDER BY oi.id) AS items
       FROM orders o
       JOIN floors f ON f.id = o.floor_id
       JOIN order_items oi ON oi.order_id = o.id AND oi.station = $1 AND oi.ready_at IS NULL
       JOIN products p ON p.id = oi.product_id
      WHERE o.status IN ('nouvelle', 'en_preparation') AND ${bizDay("o.created_at")} = ${TODAY}
      GROUP BY o.id, f.name
      ORDER BY o.created_at`, [station]);
  res.json({ station, orders: rows });
}));

router.post("/kitchen/orders/:id/ready", kitchenStaff, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const station = stationOf(req);
  const { rowCount } = await pool.query(
    `UPDATE order_items SET ready_at = now()
      WHERE order_id = $1 AND station = $2 AND ready_at IS NULL
        AND EXISTS (SELECT 1 FROM orders WHERE id = $1 AND status IN ('nouvelle', 'en_preparation'))`,
    [id, station]);
  if (!rowCount) throw new HttpError(404, "Rien à préparer pour cette commande");
  // Tout est prêt (cuisine + bar) : la commande est prête à servir
  const { rows: [o] } = await pool.query(
    `UPDATE orders SET ready_at = now(), updated_at = now()
      WHERE id = $1 AND ready_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = $1 AND ready_at IS NULL)
      RETURNING id`, [id]);
  res.json({ id, station, orderReady: !!o });
}));

module.exports = router;
