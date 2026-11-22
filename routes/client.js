const crypto = require("crypto");
const express = require("express");
const pool = require("../db/pool");
const { HttpError, wrap, toMil, toDT, pointsOf } = require("../lib/http");
const { createSession, deleteSession, requireClient } = require("../lib/auth");
const { listOrders } = require("../lib/orders");
const { sendSms, exposeCodeForDev } = require("../lib/sms");
const { bizDay, TODAY } = require("../lib/day");

const router = express.Router();

const cleanPhone = (v) => String(v || "").replace(/\D/g, "");
const codeHash = (phone, code) => crypto.createHash("sha256").update(`${phone}:${code}`).digest("hex");

// Limite par adresse IP pour les SMS (chaque SMS coûte) : 10 par heure
const smsByIp = new Map();
function checkSmsIp(ip) {
  const now = Date.now(), e = smsByIp.get(ip);
  if (!e || e.until < now) return smsByIp.set(ip, { n: 1, until: now + 3600e3 });
  if (++e.n > 10) throw new HttpError(429, "Trop de demandes de code, réessaie plus tard");
}

// Vérifie qu'une table existe dans la terrasse choisie
async function checkTable(db, floorId, table) {
  if (!Number.isInteger(floorId)) throw new HttpError(400, "Choisis ta terrasse");
  const t = Number(table);
  if (!/^\d{1,3}$/.test(String(table ?? "")) || t < 1) throw new HttpError(400, "Numéro de table invalide");
  const { rows } = await db.query("SELECT name, table_from, table_to FROM floors WHERE id = $1", [floorId]);
  if (!rows.length) throw new HttpError(400, "Terrasse inconnue");
  const f = rows[0];
  if (t < f.table_from || t > f.table_to) {
    throw new HttpError(400, `Table ${t} introuvable : ${f.name} a les tables ${f.table_from} à ${f.table_to}`);
  }
  return String(t);
}

// ---- Connexion : 1) demander un code SMS ----
router.post("/client/code", wrap(async (req, res) => {
  const phone = cleanPhone((req.body || {}).phone);
  if (!/^\d{8}$/.test(phone)) throw new HttpError(400, "Numéro de téléphone invalide (8 chiffres)");

  const { rows: [prev] } = await pool.query(
    `SELECT sent_at > now() - interval '60 seconds' AS too_soon,
            CASE WHEN window_at > now() - interval '1 hour' THEN sends ELSE 0 END AS sends
       FROM otp_codes WHERE phone = $1`, [phone]);
  if (prev && prev.too_soon) throw new HttpError(429, "Attends une minute avant de redemander un code");
  if (prev && prev.sends >= 5) throw new HttpError(429, "Trop de codes demandés, réessaie dans une heure");
  checkSmsIp(req.ip);

  const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
  await pool.query(
    `INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1, $2, now() + interval '10 minutes')
     ON CONFLICT (phone) DO UPDATE SET
       code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0, sent_at = now(),
       sends = CASE WHEN otp_codes.window_at > now() - interval '1 hour' THEN otp_codes.sends + 1 ELSE 1 END,
       window_at = CASE WHEN otp_codes.window_at > now() - interval '1 hour' THEN otp_codes.window_at ELSE now() END`,
    [phone, codeHash(phone, code)]);

  try {
    await sendSms(phone, `707 Café : ton code est ${code} (valable 10 min).`);
  } catch {
    throw new HttpError(502, "SMS non envoyé, réessaie dans un instant");
  }
  const { rows: known } = await pool.query("SELECT 1 FROM clients WHERE phone = $1", [phone]);
  res.json({ sent: true, isNew: !known.length, ...(exposeCodeForDev() ? { devCode: code } : {}) });
}));

// ---- Connexion : 2) vérifier le code ----
router.post("/client/verify", wrap(async (req, res) => {
  const phone = cleanPhone((req.body || {}).phone);
  const code = String((req.body || {}).code || "").replace(/\D/g, "");
  const name = String((req.body || {}).name || "").trim().slice(0, 40);
  if (!/^\d{8}$/.test(phone) || !/^\d{6}$/.test(code)) throw new HttpError(400, "Code invalide");

  const { rows: [client0] } = await pool.query("SELECT id FROM clients WHERE phone = $1", [phone]);
  if (!client0 && name.length < 2) throw new HttpError(400, "Écris ton prénom");

  const { rows: [otp] } = await pool.query(
    "SELECT code_hash, attempts, expires_at > now() AS valid FROM otp_codes WHERE phone = $1", [phone]);
  if (!otp || !otp.valid) throw new HttpError(400, "Code expiré, demande un nouveau code");
  if (otp.attempts >= 5) throw new HttpError(429, "Trop d'essais, demande un nouveau code");
  const a = Buffer.from(otp.code_hash, "hex"), b = Buffer.from(codeHash(phone, code), "hex");
  if (!crypto.timingSafeEqual(a, b)) {
    await pool.query("UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = $1", [phone]);
    throw new HttpError(400, "Code incorrect");
  }
  // Code utilisé une seule fois ; garder la date d'envoi pour la limite d'une minute
  await pool.query("UPDATE otp_codes SET expires_at = now(), attempts = 5 WHERE phone = $1", [phone]);

  const { rows: [client] } = await pool.query(
    `INSERT INTO clients (name, phone) VALUES ($1, $2)
     ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
     RETURNING id, name, phone, points`, [name || "Client", phone]);
  const token = await createSession("client", client.id);
  res.json({ token, client });
}));

router.post("/client/logout", wrap(async (req, res) => {
  await deleteSession(req);
  res.json({ ok: true });
}));

const orderForClient = (o) => ({
  id: o.id, status: o.status, ready: o.ready, floor: o.floor_name, table: o.table_no,
  subtotal: o.subtotal, discount: o.discount, total: o.total, pointsUsed: o.points_used, pointsEarned: o.points_earned,
  payment: o.paid_method || o.payment, paidAt: o.paid_at, createdAt: o.created_at,
  items: (o.items || []).map(i => ({ name: i.name, icon: i.icon, qty: i.qty, unit: i.unit, options: i.options })),
});

// ---- Mon compte : points, dernière commande, historique ----
router.get("/client/me", requireClient, wrap(async (req, res) => {
  const { rows: last } = await pool.query(
    `SELECT oi.product_id, oi.qty, oi.options
       FROM order_items oi
      WHERE oi.order_id = (SELECT id FROM orders WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1)
      ORDER BY oi.id`, [req.client.id]);
  const orders = await listOrders({ clientId: req.client.id, scope: "client", limit: 15 });
  res.json({
    ...req.client,
    lastOrder: last.map(l => ({ productId: l.product_id, qty: l.qty, optionIds: l.options.map(o => o.id) })),
    orders: orders.map(orderForClient),
  });
}));

// ---- Suivi en direct : commandes en cours + appels récents ----
router.get("/client/live", requireClient, wrap(async (req, res) => {
  const { rows: orders } = await pool.query(
    `SELECT id, status, ready_at IS NOT NULL AS ready FROM orders
      WHERE client_id = $1 AND ${bizDay("created_at")} = ${TODAY}
        AND (status NOT IN ('payee', 'annulee') OR updated_at > now() - interval '2 minutes')
      ORDER BY id`, [req.client.id]);
  const { rows: calls } = await pool.query(
    `SELECT id, kind, status FROM calls
      WHERE client_id = $1 AND created_at > now() - interval '30 minutes' ORDER BY id`, [req.client.id]);
  res.json({ points: req.client.points, orders, calls });
}));

// ---- Appeler le serveur / demander l'addition ----
router.post("/client/calls", requireClient, wrap(async (req, res) => {
  const { floorId, table, kind, payment } = req.body || {};
  if (!["serveur", "addition"].includes(kind)) throw new HttpError(400, "Demande invalide");
  if (payment != null && !["Espèces", "Carte"].includes(payment)) throw new HttpError(400, "Paiement invalide");
  const tableNo = await checkTable(pool, floorId, table);

  // Déjà un appel ouvert à cette table : on ne le double pas
  const { rows: open } = await pool.query(
    `SELECT id, kind, status FROM calls WHERE floor_id = $1 AND table_no = $2 AND kind = $3 AND status = 'ouvert'`,
    [floorId, tableNo, kind]);
  if (open.length) return res.json(open[0]);
  const { rows: recent } = await pool.query(
    "SELECT 1 FROM calls WHERE client_id = $1 AND created_at > now() - interval '20 seconds'", [req.client.id]);
  if (recent.length) throw new HttpError(429, "Ton serveur est déjà prévenu");

  const { rows: [call] } = await pool.query(
    `INSERT INTO calls (floor_id, table_no, client_id, kind, payment) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, kind, status`, [floorId, tableNo, req.client.id, kind, kind === "addition" ? payment || null : null]);
  res.status(201).json(call);
}));

// ---- Commande ----
// Le client envoie seulement les ids et quantités : prix, points, remise et stock sont calculés ici.
// usePoints : points à dépenser (multiple de 10 ; 10 points = 1 DT).
router.post("/orders", requireClient, wrap(async (req, res) => {
  const { floorId, table, payment, lines, usePoints = 0 } = req.body || {};
  if (!["Espèces", "Carte"].includes(payment)) throw new HttpError(400, "Paiement invalide");
  if (!Number.isInteger(usePoints) || usePoints < 0 || usePoints % 10 !== 0) throw new HttpError(400, "Points invalides");
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 50) throw new HttpError(400, "Panier vide ou trop grand");
  for (const l of lines) {
    if (!l || !Number.isInteger(l.productId) || !Number.isInteger(l.qty) || l.qty < 1 || l.qty > 50) {
      throw new HttpError(400, "Ligne de commande invalide");
    }
    if (l.optionIds !== undefined && !Array.isArray(l.optionIds)) throw new HttpError(400, "Options invalides");
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const tableNo = await checkTable(db, floorId, table);

    const ids = [...new Set(lines.map(l => l.productId))];
    // FOR UPDATE : deux commandes en même temps ne peuvent pas vendre le même stock
    const { rows: prods } = await db.query(
      `SELECT p.*, c.station FROM products p JOIN categories c ON c.key = p.category_key
        WHERE p.id = ANY($1) FOR UPDATE OF p`, [ids]);
    const { rows: opts } = await db.query(
      `SELECT o.id, o.name, o.price, g.product_id, g.id AS group_id, g.single
         FROM options o JOIN option_groups g ON g.id = o.group_id
        WHERE g.product_id = ANY($1)`, [ids]);

    const qtyByProduct = new Map();
    let subtotalMil = 0, earned = 0;
    const items = lines.map(l => {
      const p = prods.find(x => x.id === l.productId);
      if (!p || p.archived) throw new HttpError(400, "Produit introuvable");
      if (p.sold_out || p.stock === 0) throw new HttpError(409, `${p.name} est épuisé`);
      qtyByProduct.set(p.id, (qtyByProduct.get(p.id) || 0) + l.qty);

      const chosen = [...new Set(l.optionIds || [])].map(oid => {
        const o = opts.find(x => x.id === oid && x.product_id === p.id);
        if (!o) throw new HttpError(400, `Option invalide pour ${p.name}`);
        return { id: o.id, name: o.name, price: Number(o.price), groupId: o.group_id, single: o.single };
      });
      const singles = chosen.filter(o => o.single).map(o => o.groupId);
      if (new Set(singles).size !== singles.length) throw new HttpError(400, `Un seul choix par groupe pour ${p.name}`);
      chosen.forEach(o => { delete o.groupId; delete o.single; });

      const unitMil = toMil(p.price) + chosen.reduce((s, o) => s + toMil(o.price), 0);
      subtotalMil += unitMil * l.qty;
      earned += pointsOf(unitMil) * l.qty;
      return { productId: p.id, qty: l.qty, unit: toDT(unitMil), options: chosen, station: p.station };
    });

    for (const [pid, q] of qtyByProduct) {
      const p = prods.find(x => x.id === pid);
      if (p.stock !== null && p.stock < q) throw new HttpError(409, `Plus que ${p.stock} ${p.name} en stock`);
    }

    // Paiement en points : 10 points = 1 DT, sans dépasser le solde ni le montant
    const { rows: [cl] } = await db.query("SELECT points FROM clients WHERE id = $1 FOR UPDATE", [req.client.id]);
    if (usePoints > cl.points) throw new HttpError(400, `Tu n'as que ${cl.points} points`);
    const maxPoints = Math.floor(subtotalMil / 1000) * 10;
    if (usePoints > maxPoints) throw new HttpError(400, `Maximum ${maxPoints} points pour cette commande`);
    const discountMil = usePoints * 100;
    const totalMil = subtotalMil - discountMil;
    // Les points gagnés portent sur ce qui est vraiment payé
    if (discountMil > 0) earned = Math.min(earned, Math.floor(totalMil / 1000));

    const { rows: [order] } = await db.query(
      `INSERT INTO orders (client_id, floor_id, table_no, payment, subtotal, discount, total, points_used, points_earned)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [req.client.id, floorId, tableNo, payment, toDT(subtotalMil), toDT(discountMil), toDT(totalMil), usePoints, earned]);

    for (const it of items) {
      await db.query(
        `INSERT INTO order_items (order_id, product_id, qty, unit_price, options, station)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, it.productId, it.qty, it.unit, JSON.stringify(it.options), it.station]);
    }
    for (const [pid, q] of qtyByProduct) {
      await db.query("UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock IS NOT NULL", [pid, q]);
    }
    const { rows: [bal] } = await db.query(
      "UPDATE clients SET points = points - $2 + $3 WHERE id = $1 RETURNING points", [req.client.id, usePoints, earned]);

    await db.query("COMMIT");
    res.status(201).json({
      orderId: order.id, subtotal: toDT(subtotalMil), discount: toDT(discountMil), total: toDT(totalMil),
      pointsUsed: usePoints, pointsEarned: earned, points: bal.points,
    });
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}));

module.exports = router;
