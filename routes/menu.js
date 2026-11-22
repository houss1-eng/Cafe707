const express = require("express");
const QRCode = require("qrcode");
const pool = require("../db/pool");
const { HttpError, wrap } = require("../lib/http");

const router = express.Router();

// Menu public : terrasses (avec leurs tables), catégories, produits, options
router.get("/menu", wrap(async (req, res) => {
  const [floors, cats, subs, prods, groups, opts] = await Promise.all([
    pool.query("SELECT id, name, table_from, table_to FROM floors ORDER BY position, id"),
    pool.query("SELECT key, label, title FROM categories ORDER BY position, label"),
    pool.query("SELECT category_key, name FROM subcategories ORDER BY position, name"),
    pool.query("SELECT * FROM products WHERE NOT archived ORDER BY position, id"),
    pool.query("SELECT id, product_id, title, single FROM option_groups ORDER BY position, id"),
    pool.query("SELECT id, group_id, name, price, kcal FROM options ORDER BY position, name"),
  ]);

  const tabs = cats.rows.map(c => {
    // Ordre défini par l'admin, puis les sous-catégories utilisées mais pas encore rangées
    const ordered = subs.rows.filter(x => x.category_key === c.key).map(x => x.name);
    const used = [...new Set(prods.rows.filter(p => p.category_key === c.key && p.subcategory).map(p => p.subcategory))];
    const all = ordered.filter(s => used.includes(s)).concat(used.filter(s => !ordered.includes(s)));
    return all.length ? { ...c, subs: all } : c;
  });

  const products = prods.rows.map(p => {
    const product = {
      id: p.id, name: p.name, price: Number(p.price), kcal: p.kcal,
      cat: p.category_key, sub: p.subcategory, kind: p.kind, icon: p.icon, note: p.note,
      badge: p.badge || undefined, fav: p.favorite,
      image: p.image_id ? `/api/images/${p.image_id}` : undefined,
      soldOut: p.sold_out || p.stock === 0,
    };
    const g = groups.rows.filter(x => x.product_id === p.id);
    if (g.length) {
      product.groups = g.map(x => ({
        title: x.title,
        single: x.single,
        items: opts.rows.filter(o => o.group_id === x.id)
          .map(o => ({ id: o.id, name: o.name, price: Number(o.price), kcal: o.kcal })),
      })).filter(x => x.items.length);
    }
    return product;
  });

  res.json({
    floors: floors.rows.map(f => ({ id: f.id, name: f.name, tableFrom: f.table_from, tableTo: f.table_to })),
    tabs, products,
  });
}));

// Photos des produits (stockées en base)
router.get("/images/:id", wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new HttpError(404, "Image introuvable");
  const { rows } = await pool.query("SELECT mime, data FROM images WHERE id = $1", [id]);
  if (!rows.length) throw new HttpError(404, "Image introuvable");
  // Une photo remplacée reçoit un nouvel id : celle-ci ne change jamais
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.type(rows[0].mime).send(rows[0].data);
}));

// QR code d'une table : lien vers le menu avec la terrasse et la table pré-remplies
router.get("/qr.svg", wrap(async (req, res) => {
  const floor = Number(req.query.floor), table = Number(req.query.table);
  const { rows } = await pool.query("SELECT table_from, table_to FROM floors WHERE id = $1", [floor]);
  if (!rows.length || !Number.isInteger(table) || table < rows[0].table_from || table > rows[0].table_to) {
    throw new HttpError(404, "Table inconnue");
  }
  const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
  const svg = await QRCode.toString(`${base}/?etage=${floor}&table=${table}`, {
    type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0d0b09", light: "#ffffff" },
  });
  res.set("Cache-Control", "public, max-age=300");
  res.type("image/svg+xml").send(svg);
}));

// Auteurs et licences des photos de départ (Wikimedia Commons)
const fs = require("fs");
const path = require("path");
router.get("/credits", (req, res) => {
  const f = path.join(__dirname, "..", "db", "photos", "credits.json");
  const c = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
  res.set("Cache-Control", "public, max-age=3600");
  res.json(Object.entries(c).map(([id, x]) => ({ productId: Number(id), author: x.author, license: x.license, source: x.source })));
});

module.exports = router;
