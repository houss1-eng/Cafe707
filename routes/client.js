const express = require("express");
const pool = require("../db/pool");
const { HttpError, wrap, toMil, toDT, pointsOf } = require("../lib/http");
const { createSession, deleteSession, requireClient, hashPassword, verifyPassword, newClientCode } = require("../lib/auth");
const { listOrders } = require("../lib/orders");
const { bizDay, TODAY } = require("../lib/day");
const limit = require("../lib/limit");
const push = require("../lib/push");

const router = express.Router();

const cleanPhone = (v) => String(v || "").replace(/\D/g, "");

// Café fermé par l'admin : aucune commande ni appel. FOR SHARE : une fermeture attend les commandes en cours d'envoi.
async function assertOpen(db, lock = false) {
  const { rows } = await db.query(`SELECT is_open FROM settings WHERE id = 1${lock ? " FOR SHARE" : ""}`);
  if (!rows[0].is_open) throw new HttpError(409, "Le 707 est fermé pour le moment");
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

// ---- Connexion sans SMS : numéro + code personnel à 6 chiffres ----
const phoneOf = (body) => {
  const phone = cleanPhone((body || {}).phone);
  if (!/^\d{8}$/.test(phone)) throw new HttpError(400, "Numéro de téléphone invalide (8 chiffres)");
  return phone;
};

// 1) Ce numéro a-t-il déjà un compte ? (limites larges : tout le café peut partager le même Wi-Fi)
router.post("/client/check", wrap(async (req, res) => {
  const phone = phoneOf(req.body);
  if (await limit.hit(`check:${req.ip}`, 600) > 120) throw new HttpError(429, "Trop d'essais, réessaie dans quelques minutes");
  const { rows } = await pool.query("SELECT 1 FROM clients WHERE phone = $1", [phone]);
  res.json({ isNew: !rows.length });
}));

// 2a) Nouveau compte : le code est renvoyé cette seule fois
router.post("/client/register", wrap(async (req, res) => {
  const phone = phoneOf(req.body);
  const name = String((req.body || {}).name || "").trim().slice(0, 40);
  if (name.length < 2) throw new HttpError(400, "Écris ton prénom");
  if (await limit.hit(`register:${req.ip}`, 3600) > 30) throw new HttpError(429, "Trop de comptes créés, réessaie plus tard");
  const code = newClientCode();
  const { rows: [client] } = await pool.query(
    `INSERT INTO clients (name, phone, pin_hash) VALUES ($1, $2, $3)
     ON CONFLICT (phone) DO NOTHING RETURNING id, name, phone, points`, [name, phone, hashPassword(code)]);
  if (!client) throw new HttpError(409, "Ce numéro a déjà un compte");
  const token = await createSession("client", client.id);
  res.status(201).json({ token, client, code });
}));

// 2b) Compte existant : 5 erreurs bloquent ce numéro 15 min
router.post("/client/login", wrap(async (req, res) => {
  const phone = phoneOf(req.body);
  const code = String((req.body || {}).code || "").replace(/\D/g, "");
  const phoneKey = `pin:${phone}`, ipKey = `pinip:${req.ip}`;
  if (await limit.countOf(phoneKey) >= 5 || await limit.countOf(ipKey) >= 30) {
    throw new HttpError(429, "Trop d'essais, réessaie dans 15 minutes");
  }
  const { rows: [c] } = await pool.query("SELECT id, name, phone, points, pin_hash FROM clients WHERE phone = $1", [phone]);
  if (c && !c.pin_hash) throw new HttpError(403, "Demande ton code personnel au 707");
  if (!c || !/^\d{6}$/.test(code) || !verifyPassword(code, c.pin_hash)) {
    await limit.hit(ipKey, 600);
    if (c) await limit.hit(phoneKey, 900);
    throw new HttpError(400, "Numéro ou code incorrect");
  }
  await limit.clear(phoneKey);
  const token = await createSession("client", c.id);
  res.json({ token, client: { id: c.id, name: c.name, phone: c.phone, points: c.points } });
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
  // L'addition reste possible après la fermeture : les clients encore à table doivent pouvoir payer
  if (kind === "serveur") await assertOpen(pool);
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
  await push.toStaff({ roles: ["serveur"], floorId }, {
    title: kind === "addition" ? `Table ${tableNo} : l'addition` : `Table ${tableNo} t'appelle`,
    body: kind === "addition" ? `${req.client.name} demande l'addition${payment ? ` (${payment})` : ""}` : `${req.client.name} appelle le serveur`,
    tag: `call-${call.id}`,
  });
  res.status(201).json(call);
}));

// ---- Commande ----
// Le client envoie seulement les ids et quantités : prix, points, remise et stock sont calculés ici.
// usePoints : points à dépenser (multiple de 10 ; 10 points = 1 DT).
router.post("/orders", requireClient, wrap(async (req, res) => {
  const { floorId, table, payment, lines, usePoints = 0 } = req.body || {};
  if (payment != null && !["Espèces", "Carte"].includes(payment)) throw new HttpError(400, "Paiement invalide");
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
    await assertOpen(db, true);
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
      [req.client.id, floorId, tableNo, payment || null, toDT(subtotalMil), toDT(discountMil), toDT(totalMil), usePoints, earned]);

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
    // Nouvelle commande : le serveur de la terrasse, puis la cuisine et le bar s'ils ont quelque chose à préparer
    const summary = (list) => list.map(it => `${it.qty} × ${prods.find(p => p.id === it.productId).name}`).join(", ");
    const stations = ["cuisine", "bar"].filter(st => items.some(it => it.station === st));
    await Promise.all([
      push.toStaff({ roles: ["serveur"], floorId }, {
        title: `Nouvelle commande · Table ${tableNo}`, body: `N°${order.id} · ${summary(items)}`, tag: `order-${order.id}`,
      }),
      ...stations.map(st => push.toStaff({ roles: [st] }, {
        title: `Commande n°${order.id} · Table ${tableNo}`, body: summary(items.filter(it => it.station === st)), tag: `order-${order.id}`,
      })),
    ]);
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
