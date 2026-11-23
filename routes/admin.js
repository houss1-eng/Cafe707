const crypto = require("crypto");
const express = require("express");
const pool = require("../db/pool");
const { HttpError, wrap, toMil, toDT } = require("../lib/http");
const auth = require("../lib/auth");
const { bizDay, TODAY, isDate } = require("../lib/day");

const router = express.Router();
router.use("/admin", auth.requireStaff("admin"));

// UPDATE partiel : { colonne: valeur } -> "a = $2, b = $3"
function setClause(cols, startAt = 2) {
  const keys = Object.keys(cols);
  return { sql: keys.map((k, i) => `${k} = $${i + startAt}`).join(", "), vals: keys.map(k => cols[k]) };
}
const text = (v, max, name, min = 0) => {
  const s = String(v ?? "").trim();
  if (s.length < min) throw new HttpError(400, `${name} trop court`);
  return s.slice(0, max);
};
const money = (v, name = "Prix") => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 9999) throw new HttpError(400, `${name} invalide`);
  return Math.round(n * 100) / 100;
};
const int = (v, name, min = 0, max = 1e6) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} invalide`);
  return n;
};

// =====================================================================
// Café disponible / non disponible
// =====================================================================
router.patch("/admin/status", wrap(async (req, res) => {
  const { open } = req.body || {};
  if (typeof open !== "boolean") throw new HttpError(400, "État invalide");
  await pool.query("UPDATE settings SET is_open = $1, updated_by = $2, updated_at = now() WHERE id = 1", [open, req.staff.id]);
  res.json({ open });
}));

// =====================================================================
// Prix des terrains (null = pas encore fixé)
// =====================================================================
router.patch("/admin/pitches/:id", wrap(async (req, res) => {
  const id = int(req.params.id, "Terrain", 1, 2147483647);
  const { price } = req.body || {};
  if (price !== null && (typeof price !== "number" || !Number.isFinite(price) || price <= 0 || price > 9999)) {
    throw new HttpError(400, "Prix invalide");
  }
  const mil = price === null ? null : toMil(price);
  if (mil === 0) throw new HttpError(400, "Prix invalide");
  const { rows } = await pool.query("UPDATE pitches SET price_mil = $2 WHERE id = $1 RETURNING price_mil", [id, mil]);
  if (!rows.length) throw new HttpError(404, "Terrain introuvable");
  res.json({ id, price: mil === null ? null : toDT(mil) });
}));

// =====================================================================
// Tableau de bord (aujourd'hui)
// =====================================================================
router.get("/admin/stats", wrap(async (req, res) => {
  const today = `${bizDay("o.created_at")} = ${TODAY}`;
  const [tot, byFloor, byStatus, top, calls] = await Promise.all([
    pool.query(`SELECT count(*)::int AS orders, COALESCE(sum(total), 0)::float AS revenue
                  FROM orders o WHERE ${today} AND status <> 'annulee'`),
    pool.query(`SELECT f.id, f.name, count(o.id)::int AS orders, COALESCE(sum(o.total), 0)::float AS revenue,
                       count(o.id) FILTER (WHERE o.status IN ('nouvelle','en_preparation','servie'))::int AS active
                  FROM floors f
                  LEFT JOIN orders o ON o.floor_id = f.id AND ${today} AND o.status <> 'annulee'
                 GROUP BY f.id ORDER BY f.position, f.id`),
    pool.query(`SELECT status, count(*)::int AS n FROM orders o WHERE ${today} GROUP BY status`),
    pool.query(`SELECT p.name, p.icon, sum(oi.qty)::int AS qty
                  FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
                 WHERE ${today} AND o.status <> 'annulee'
                 GROUP BY p.id ORDER BY qty DESC LIMIT 5`),
    pool.query(`SELECT count(*)::int AS n FROM calls WHERE status = 'ouvert'`),
  ]);
  res.json({
    ...tot.rows[0],
    floors: byFloor.rows,
    statuses: Object.fromEntries(byStatus.rows.map(r => [r.status, r.n])),
    top: top.rows,
    openCalls: calls.rows[0].n,
  });
}));

// =====================================================================
// Menu : catégories, produits, options, photos
// =====================================================================
router.get("/admin/menu", wrap(async (req, res) => {
  const [cats, subs, prods, groups, opts] = await Promise.all([
    pool.query("SELECT key, label, title, station, position FROM categories ORDER BY position, label"),
    pool.query("SELECT category_key, name FROM subcategories ORDER BY position, name"),
    pool.query(`SELECT id, name, price::float AS price, kcal, category_key, subcategory, kind, icon, note, badge,
                       image_id, favorite, sold_out, archived, stock, position
                  FROM products ORDER BY archived, position, id`),
    pool.query("SELECT id, product_id, title, single, position FROM option_groups ORDER BY position, id"),
    pool.query("SELECT id, group_id, name, price::float AS price, kcal FROM options ORDER BY position, name"),
  ]);
  res.json({
    categories: cats.rows.map(c => ({ ...c, subs: subs.rows.filter(s => s.category_key === c.key).map(s => s.name) })),
    products: prods.rows.map(p => ({
      ...p,
      image: p.image_id ? `/api/images/${p.image_id}` : null,
      groups: groups.rows.filter(g => g.product_id === p.id)
        .map(g => ({ ...g, options: opts.rows.filter(o => o.group_id === g.id) })),
    })),
  });
}));

// --- Catégories ---
const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "cat";

router.post("/admin/categories", wrap(async (req, res) => {
  const b = req.body || {};
  const label = text(b.label, 30, "Nom", 2);
  const station = b.station === "bar" ? "bar" : "cuisine";
  let key = slug(label);
  const { rows: taken } = await pool.query("SELECT key FROM categories WHERE key LIKE $1", [`${key}%`]);
  if (taken.some(t => t.key === key) || key === "pour-toi") key = `${key}-${taken.length + 1}`;
  const { rows: [{ pos }] } = await pool.query("SELECT COALESCE(max(position), 0) + 1 AS pos FROM categories");
  await pool.query("INSERT INTO categories (key, label, title, station, position) VALUES ($1, $2, $2, $3, $4)",
    [key, label, station, pos]);
  res.status(201).json({ key });
}));

router.patch("/admin/categories/:key", wrap(async (req, res) => {
  const b = req.body || {};
  const cols = {};
  if (b.label !== undefined) { cols.label = text(b.label, 30, "Nom", 2); cols.title = cols.label; }
  if (b.station !== undefined) cols.station = b.station === "bar" ? "bar" : "cuisine";
  if (b.position !== undefined) cols.position = int(b.position, "Position", 0, 999);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const { rows } = await db.query("SELECT key FROM categories WHERE key = $1 FOR UPDATE", [req.params.key]);
    if (!rows.length) throw new HttpError(404, "Catégorie introuvable");
    if (Object.keys(cols).length) {
      const { sql, vals } = setClause(cols);
      await db.query(`UPDATE categories SET ${sql} WHERE key = $1`, [req.params.key, ...vals]);
    }
    // Sous-catégories : liste ordonnée, remplace l'ancienne
    if (b.subs !== undefined) {
      if (!Array.isArray(b.subs) || b.subs.length > 30) throw new HttpError(400, "Sous-catégories invalides");
      const subs = [...new Set(b.subs.map(s => String(s).trim().slice(0, 40)).filter(Boolean))];
      await db.query("DELETE FROM subcategories WHERE category_key = $1", [req.params.key]);
      for (const [i, s] of subs.entries()) {
        await db.query("INSERT INTO subcategories (category_key, name, position) VALUES ($1, $2, $3)", [req.params.key, s, i]);
      }
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    db.release();
  }
  res.json({ ok: true });
}));

router.delete("/admin/categories/:key", wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM products WHERE category_key = $1", [req.params.key]);
  if (rows[0].n) throw new HttpError(409, "Catégorie non vide : déplace ou retire d'abord ses produits");
  await pool.query("DELETE FROM categories WHERE key = $1", [req.params.key]);
  res.json({ ok: true });
}));

// --- Produits ---
function productCols(b, creating) {
  const c = {};
  const has = (k) => creating || b[k] !== undefined;
  if (has("name")) c.name = text(b.name, 60, "Nom", 2);
  if (has("price")) c.price = money(b.price);
  if (b.kcal !== undefined) c.kcal = int(b.kcal || 0, "Calories", 0, 9999);
  if (has("category")) c.category_key = text(b.category, 40, "Catégorie", 1);
  if (b.subcategory !== undefined) c.subcategory = text(b.subcategory, 40, "Sous-catégorie");
  if (b.icon !== undefined) c.icon = text(b.icon, 8, "Icône");
  if (b.note !== undefined) c.note = text(b.note, 120, "Description");
  if (b.badge !== undefined) c.badge = text(b.badge, 30, "Badge") || null;
  if (b.kind !== undefined) c.kind = b.kind === "pizza" ? "pizza" : "simple";
  if (b.favorite !== undefined) c.favorite = !!b.favorite;
  if (b.soldOut !== undefined) c.sold_out = !!b.soldOut;
  if (b.archived !== undefined) c.archived = !!b.archived;
  if (b.stock !== undefined) c.stock = b.stock === null || b.stock === "" ? null : int(b.stock, "Stock");
  if (b.imageId !== undefined) c.image_id = b.imageId === null ? null : int(b.imageId, "Photo", 1);
  if (b.position !== undefined) c.position = int(b.position, "Position", 0, 9999);
  return c;
}
const fkError = (err) => {
  if (err.code === "23503") throw new HttpError(400, "Catégorie ou photo inconnue");
  throw err;
};

router.post("/admin/products", wrap(async (req, res) => {
  const cols = productCols(req.body || {}, true);
  const keys = Object.keys(cols);
  try {
    const { rows } = await pool.query(
      `INSERT INTO products (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
      keys.map(k => cols[k]));
    res.status(201).json(rows[0]);
  } catch (err) { fkError(err); }
}));

router.patch("/admin/products/:id", wrap(async (req, res) => {
  const cols = productCols(req.body || {}, false);
  if (!Object.keys(cols).length) throw new HttpError(400, "Rien à modifier");
  const { sql, vals } = setClause(cols);
  try {
    const { rows } = await pool.query(
      `UPDATE products SET ${sql} WHERE id = $1 RETURNING id, name, price::float AS price, stock, sold_out, archived`,
      [Number(req.params.id), ...vals]);
    if (!rows.length) throw new HttpError(404, "Produit introuvable");
    res.json(rows[0]);
  } catch (err) { fkError(err); }
}));

// --- Groupes d'options et options (suppléments, sauces, tailles...) ---
router.post("/admin/products/:id/groups", wrap(async (req, res) => {
  const b = req.body || {};
  try {
    const { rows } = await pool.query(
      `INSERT INTO option_groups (product_id, title, single, position)
       VALUES ($1, $2, $3, (SELECT COALESCE(max(position), 0) + 1 FROM option_groups WHERE product_id = $1))
       RETURNING id`, [Number(req.params.id), text(b.title, 40, "Titre", 2), !!b.single]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23503") throw new HttpError(404, "Produit introuvable");
    throw err;
  }
}));

router.patch("/admin/groups/:id", wrap(async (req, res) => {
  const b = req.body || {};
  const cols = {};
  if (b.title !== undefined) cols.title = text(b.title, 40, "Titre", 2);
  if (b.single !== undefined) cols.single = !!b.single;
  if (!Object.keys(cols).length) throw new HttpError(400, "Rien à modifier");
  const { sql, vals } = setClause(cols);
  const { rowCount } = await pool.query(`UPDATE option_groups SET ${sql} WHERE id = $1`, [Number(req.params.id), ...vals]);
  if (!rowCount) throw new HttpError(404, "Groupe introuvable");
  res.json({ ok: true });
}));

router.delete("/admin/groups/:id", wrap(async (req, res) => {
  await pool.query("DELETE FROM option_groups WHERE id = $1", [Number(req.params.id)]);
  res.json({ ok: true });
}));

router.post("/admin/groups/:id/options", wrap(async (req, res) => {
  const b = req.body || {};
  const id = `o-${crypto.randomBytes(4).toString("hex")}`;
  try {
    await pool.query(
      `INSERT INTO options (id, group_id, name, price, kcal, position)
       VALUES ($1, $2, $3, $4, $5, (SELECT COALESCE(max(position), 0) + 1 FROM options WHERE group_id = $2))`,
      [id, Number(req.params.id), text(b.name, 40, "Nom", 1), money(b.price ?? 0), int(b.kcal || 0, "Calories", 0, 9999)]);
  } catch (err) {
    if (err.code === "23503") throw new HttpError(404, "Groupe introuvable");
    throw err;
  }
  res.status(201).json({ id });
}));

router.patch("/admin/options/:id", wrap(async (req, res) => {
  const b = req.body || {};
  const cols = {};
  if (b.name !== undefined) cols.name = text(b.name, 40, "Nom", 1);
  if (b.price !== undefined) cols.price = money(b.price);
  if (b.kcal !== undefined) cols.kcal = int(b.kcal || 0, "Calories", 0, 9999);
  if (!Object.keys(cols).length) throw new HttpError(400, "Rien à modifier");
  const { sql, vals } = setClause(cols);
  const { rowCount } = await pool.query(`UPDATE options SET ${sql} WHERE id = $1`, [req.params.id, ...vals]);
  if (!rowCount) throw new HttpError(404, "Option introuvable");
  res.json({ ok: true });
}));

router.delete("/admin/options/:id", wrap(async (req, res) => {
  await pool.query("DELETE FROM options WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));

// --- Photos : envoyées en data URL (déjà réduites par le navigateur), 600 Ko max ---
router.post("/admin/images", express.json({ limit: "1mb" }), wrap(async (req, res) => {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String((req.body || {}).dataUrl || ""));
  if (!m) throw new HttpError(400, "Image invalide (JPEG, PNG ou WebP)");
  const data = Buffer.from(m[2], "base64");
  if (data.length > 600 * 1024) throw new HttpError(413, "Photo trop lourde (600 Ko max)");
  const { rows } = await pool.query("INSERT INTO images (mime, data) VALUES ($1, $2) RETURNING id", [m[1], data]);
  res.status(201).json({ id: rows[0].id, url: `/api/images/${rows[0].id}` });
}));

// =====================================================================
// Terrasses et tables
// =====================================================================
router.get("/admin/floors", wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT f.id, f.name, f.table_from, f.table_to, f.position,
            (SELECT count(*)::int FROM staff s WHERE s.floor_id = f.id AND s.active) AS staff
       FROM floors f ORDER BY f.position, f.id`);
  res.json(rows);
}));

async function checkOverlap(db, from, to, exceptId = null) {
  const { rows } = await db.query(
    `SELECT name FROM floors WHERE ($3::int IS NULL OR id <> $3) AND table_from <= $2 AND table_to >= $1`,
    [from, to, exceptId]);
  if (rows.length) throw new HttpError(409, `Ces numéros de table sont déjà pris par ${rows[0].name}`);
}

router.post("/admin/floors", wrap(async (req, res) => {
  const b = req.body || {};
  const name = text(b.name, 40, "Nom", 2);
  const from = int(b.tableFrom, "Première table", 1, 999), to = int(b.tableTo, "Dernière table", 1, 999);
  if (to < from) throw new HttpError(400, "La dernière table doit être après la première");
  await checkOverlap(pool, from, to);
  const { rows } = await pool.query(
    `INSERT INTO floors (name, table_from, table_to, position)
     VALUES ($1, $2, $3, (SELECT COALESCE(max(position), 0) + 1 FROM floors)) RETURNING id`, [name, from, to]);
  res.status(201).json(rows[0]);
}));

router.patch("/admin/floors/:id", wrap(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const { rows: [f] } = await pool.query("SELECT * FROM floors WHERE id = $1", [id]);
  if (!f) throw new HttpError(404, "Terrasse introuvable");
  const name = b.name !== undefined ? text(b.name, 40, "Nom", 2) : f.name;
  const from = b.tableFrom !== undefined ? int(b.tableFrom, "Première table", 1, 999) : f.table_from;
  const to = b.tableTo !== undefined ? int(b.tableTo, "Dernière table", 1, 999) : f.table_to;
  if (to < from) throw new HttpError(400, "La dernière table doit être après la première");
  await checkOverlap(pool, from, to, id);
  await pool.query("UPDATE floors SET name = $2, table_from = $3, table_to = $4 WHERE id = $1", [id, name, from, to]);
  res.json({ ok: true });
}));

router.delete("/admin/floors/:id", wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { rows: [u] } = await pool.query(
    `SELECT (SELECT count(*) FROM orders WHERE floor_id = $1)::int + (SELECT count(*) FROM staff WHERE floor_id = $1)::int
          + (SELECT count(*) FROM calls WHERE floor_id = $1)::int AS n`, [id]);
  if (u.n) throw new HttpError(409, "Terrasse utilisée (commandes ou serveurs) : renomme-la plutôt");
  await pool.query("DELETE FROM floors WHERE id = $1", [id]);
  res.json({ ok: true });
}));

// =====================================================================
// Équipe
// =====================================================================
const ROLES = ["serveur", "cuisine", "bar", "terrain", "admin"];

router.get("/admin/staff", wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.username, s.role, s.floor_id, f.name AS floor_name, s.active
       FROM staff s LEFT JOIN floors f ON f.id = s.floor_id
      ORDER BY array_position(ARRAY['admin','serveur','cuisine','bar','terrain'], s.role), f.position, s.name`);
  res.json(rows);
}));

function checkStaffInput(b, creating) {
  if (creating || b.name !== undefined) text(b.name, 40, "Nom", 2);
  if (creating && !/^[a-z0-9._-]{3,30}$/.test(String(b.username || ""))) {
    throw new HttpError(400, "Identifiant : 3 à 30 caractères (lettres minuscules, chiffres, . _ -)");
  }
  if ((creating || b.password !== undefined) && String(b.password || "").length < 6) {
    throw new HttpError(400, "Mot de passe : 6 caractères minimum");
  }
  if (b.role !== undefined && !ROLES.includes(b.role)) throw new HttpError(400, "Rôle invalide");
}

router.post("/admin/staff", wrap(async (req, res) => {
  const b = req.body || {};
  checkStaffInput(b, true);
  const role = b.role || "serveur";
  const floorId = role === "serveur" ? Number(b.floorId) : null;
  if (role === "serveur" && !Number.isInteger(floorId)) throw new HttpError(400, "Choisis la terrasse du serveur");
  try {
    const { rows } = await pool.query(
      `INSERT INTO staff (name, username, password_hash, role, floor_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [String(b.name).trim(), b.username, auth.hashPassword(String(b.password)), role, floorId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") throw new HttpError(409, "Cet identifiant existe déjà");
    if (err.code === "23503") throw new HttpError(400, "Terrasse inconnue");
    throw err;
  }
}));

router.patch("/admin/staff/:id", wrap(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  checkStaffInput(b, false);
  if (id === req.staff.id && (b.active === false || (b.role && b.role !== "admin"))) {
    throw new HttpError(400, "Tu ne peux pas désactiver ou rétrograder ton propre compte");
  }
  const cols = {};
  if (b.name !== undefined) cols.name = String(b.name).trim();
  if (b.role !== undefined) {
    cols.role = b.role;
    if (b.role !== "serveur") cols.floor_id = null;
  }
  if (b.floorId !== undefined) cols.floor_id = int(b.floorId, "Terrasse", 1);
  if (b.active !== undefined) cols.active = !!b.active;
  if (b.password !== undefined) cols.password_hash = auth.hashPassword(String(b.password));
  if (!Object.keys(cols).length) throw new HttpError(400, "Rien à modifier");
  const { sql, vals } = setClause(cols);
  try {
    const { rows } = await pool.query(`UPDATE staff SET ${sql} WHERE id = $1 RETURNING id`, [id, ...vals]);
    if (!rows.length) throw new HttpError(404, "Compte introuvable");
  } catch (err) {
    if (err.code === "23514") throw new HttpError(400, "Un serveur doit avoir une terrasse");
    if (err.code === "23503") throw new HttpError(400, "Terrasse inconnue");
    throw err;
  }
  // Compte désactivé, rôle ou mot de passe changé : on coupe ses sessions
  if (b.active === false || b.password !== undefined || b.role !== undefined) {
    await pool.query("DELETE FROM sessions WHERE kind = 'staff' AND subject_id = $1", [id]);
  }
  res.json({ ok: true });
}));

// =====================================================================
// Caisse : encaissé par serveur et par moyen, clôture de journée
// =====================================================================
async function cashOf(day) {
  const paidDay = `${bizDay("o.paid_at")} = $1::date`;
  const [byStaff, unpaid, closing, cancelled] = await Promise.all([
    pool.query(`SELECT COALESCE(s.name, '—') AS name, o.paid_method AS method,
                       count(*)::int AS n, sum(o.total)::float AS total, sum(o.discount)::float AS discount
                  FROM orders o LEFT JOIN staff s ON s.id = o.paid_by
                 WHERE o.status = 'payee' AND ${paidDay}
                 GROUP BY s.name, o.paid_method ORDER BY s.name`, [day]),
    pool.query(`SELECT count(*)::int AS n, COALESCE(sum(total), 0)::float AS total FROM orders o
                 WHERE o.status IN ('nouvelle','en_preparation','servie') AND ${bizDay("o.created_at")} = $1::date`, [day]),
    pool.query(`SELECT c.created_at, s.name AS closed_by, c.totals FROM closings c JOIN staff s ON s.id = c.closed_by
                 WHERE c.business_day = $1::date`, [day]),
    pool.query(`SELECT count(*)::int AS n, COALESCE(sum(total), 0)::float AS total FROM orders o
                 WHERE o.status = 'annulee' AND ${bizDay("o.created_at")} = $1::date`, [day]),
  ]);
  const staff = {};
  let especes = 0, carte = 0, count = 0, discount = 0;
  for (const r of byStaff.rows) {
    const s = (staff[r.name] ||= { name: r.name, especes: 0, carte: 0, count: 0 });
    if (r.method === "Carte") { s.carte += r.total; carte += r.total; } else { s.especes += r.total; especes += r.total; }
    s.count += r.n; count += r.n; discount += r.discount;
  }
  return {
    day, especes, carte, total: especes + carte, count, pointsDiscount: discount,
    staff: Object.values(staff), unpaid: unpaid.rows[0], cancelled: cancelled.rows[0],
    closing: closing.rows[0] || null,
  };
}

router.get("/admin/cash", wrap(async (req, res) => {
  let day = req.query.day;
  if (!isDate(day)) ({ rows: [{ day }] } = await pool.query(`SELECT to_char(${TODAY}, 'YYYY-MM-DD') AS day`));
  res.json(await cashOf(day));
}));

router.post("/admin/cash/close", wrap(async (req, res) => {
  const day = (req.body || {}).day;
  if (!isDate(day)) throw new HttpError(400, "Date invalide");
  const cash = await cashOf(day);
  if (cash.closing) throw new HttpError(409, "Cette journée est déjà clôturée");
  if (cash.unpaid.n) throw new HttpError(409, `${cash.unpaid.n} commande(s) pas encore encaissée(s) ou annulée(s)`);
  const { closing, ...totals } = cash;
  await pool.query("INSERT INTO closings (business_day, closed_by, totals) VALUES ($1, $2, $3)",
    [day, req.staff.id, JSON.stringify(totals)]);
  res.status(201).json(await cashOf(day));
}));

// =====================================================================
// Rapports sur une période + export CSV (s'ouvre dans Excel)
// =====================================================================
function period(q) {
  const { from, to } = q;
  if (!isDate(from) || !isDate(to)) throw new HttpError(400, "Période invalide");
  if (to < from) throw new HttpError(400, "La date de fin est avant la date de début");
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > 366) throw new HttpError(400, "Période limitée à un an");
  return [from, to];
}

router.get("/admin/reports", wrap(async (req, res) => {
  const p = period(req.query);
  const inPeriod = `${bizDay("o.created_at")} BETWEEN $1::date AND $2::date AND o.status <> 'annulee'`;
  const [tot, byDay, byFloor, byStaff, byPay, top, cancelled] = await Promise.all([
    pool.query(`SELECT count(*)::int AS orders, COALESCE(sum(total), 0)::float AS revenue,
                       COALESCE(sum(discount), 0)::float AS discount, COALESCE(sum(points_used), 0)::int AS points_used,
                       count(DISTINCT client_id)::int AS clients
                  FROM orders o WHERE ${inPeriod}`, p),
    pool.query(`SELECT to_char(${bizDay("o.created_at")}, 'YYYY-MM-DD') AS day, count(*)::int AS orders,
                       sum(total)::float AS revenue
                  FROM orders o WHERE ${inPeriod} GROUP BY 1 ORDER BY 1`, p),
    pool.query(`SELECT f.name, count(*)::int AS orders, sum(o.total)::float AS revenue
                  FROM orders o JOIN floors f ON f.id = o.floor_id WHERE ${inPeriod}
                 GROUP BY f.id ORDER BY revenue DESC`, p),
    pool.query(`SELECT COALESCE(s.name, 'Pas encore encaissé') AS name, count(*)::int AS orders, sum(o.total)::float AS revenue
                  FROM orders o LEFT JOIN staff s ON s.id = o.paid_by WHERE ${inPeriod}
                 GROUP BY s.name ORDER BY revenue DESC`, p),
    pool.query(`SELECT COALESCE(o.paid_method, o.payment, 'Pas encore encaissé') AS method, count(*)::int AS orders, sum(o.total)::float AS revenue
                  FROM orders o WHERE ${inPeriod} GROUP BY 1 ORDER BY 1`, p),
    pool.query(`SELECT p.name, p.icon, sum(oi.qty)::int AS qty, sum(oi.qty * oi.unit_price)::float AS revenue
                  FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
                 WHERE ${inPeriod} GROUP BY p.id ORDER BY qty DESC LIMIT 15`, p),
    pool.query(`SELECT count(*)::int AS n FROM orders o
                 WHERE ${bizDay("o.created_at")} BETWEEN $1::date AND $2::date AND o.status = 'annulee'`, p),
  ]);
  res.json({
    from: p[0], to: p[1], ...tot.rows[0], cancelled: cancelled.rows[0].n,
    days: byDay.rows, floors: byFloor.rows, staff: byStaff.rows, payments: byPay.rows, top: top.rows,
  });
}));

router.get("/admin/reports.csv", wrap(async (req, res) => {
  const p = period(req.query);
  const { rows } = await pool.query(
    `SELECT o.id, to_char(o.created_at AT TIME ZONE 'Africa/Tunis', 'YYYY-MM-DD HH24:MI') AS date, f.name AS terrasse,
            o.table_no, c.name AS client, COALESCE(pb.name, st.name) AS serveur, o.status,
            COALESCE(o.paid_method, o.payment, 'Pas encore encaissé') AS paiement, o.subtotal, o.discount, o.total, o.points_used, o.points_earned,
            (SELECT string_agg(oi.qty || 'x ' || pr.name, ', ' ORDER BY oi.id)
               FROM order_items oi JOIN products pr ON pr.id = oi.product_id WHERE oi.order_id = o.id) AS articles
       FROM orders o JOIN floors f ON f.id = o.floor_id
       LEFT JOIN clients c ON c.id = o.client_id
       LEFT JOIN staff st ON st.id = o.handled_by LEFT JOIN staff pb ON pb.id = o.paid_by
      WHERE ${bizDay("o.created_at")} BETWEEN $1::date AND $2::date
      ORDER BY o.created_at`, p);
  // Excel français : séparateur « ; », virgule décimale, BOM pour les accents
  const cell = (v) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;                      // pas de formule injectée dans Excel
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const num = (v) => Number(v).toFixed(2).replace(".", ",");
  const head = ["N°", "Date", "Terrasse", "Table", "Client", "Serveur", "Statut", "Paiement",
    "Sous-total", "Remise points", "Total", "Points utilisés", "Points gagnés", "Articles"];
  const lines = rows.map(r => [r.id, r.date, r.terrasse, r.table_no, r.client, r.serveur, r.status, r.paiement,
    num(r.subtotal), num(r.discount), num(r.total), r.points_used, r.points_earned, r.articles].map(cell).join(";"));
  res.set("Content-Disposition", `attachment; filename="707-commandes-${p[0]}-au-${p[1]}.csv"`);
  res.type("text/csv; charset=utf-8").send("﻿" + [head.join(";"), ...lines].join("\r\n"));
}));

module.exports = router;
