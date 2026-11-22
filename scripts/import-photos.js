// Donne une photo (db/photos/<id>.jpg) à chaque produit du menu qui n'en a pas encore.
// Ne remplace jamais une photo ajoutée depuis l'admin. Usage : npm run photos
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const pool = require("../db/pool");

const DIR = path.join(__dirname, "..", "db", "photos");

async function importPhotos(db = pool) {
  if (!fs.existsSync(DIR)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(DIR).filter(x => /^\d+\.jpg$/.test(x))) {
    const id = Number(f.split(".")[0]);
    const { rows } = await db.query("SELECT image_id FROM products WHERE id = $1", [id]);
    if (!rows.length || rows[0].image_id) continue;
    const { rows: [img] } = await db.query(
      "INSERT INTO images (mime, data) VALUES ('image/jpeg', $1) RETURNING id", [fs.readFileSync(path.join(DIR, f))]);
    await db.query("UPDATE products SET image_id = $2 WHERE id = $1 AND image_id IS NULL", [id, img.id]);
    n++;
  }
  return n;
}

module.exports = importPhotos;

if (require.main === module) {
  importPhotos()
    .then(n => console.log(`${n} photo(s) ajoutée(s).`))
    .catch(err => { console.error("Erreur :", err.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
