// Remplit une base VIDE : terrasses, menu de départ, comptes du personnel.
// Ne fait rien si le menu existe déjà (aucun risque d'écraser les vraies données). Usage : npm run db:seed
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const pool = require("./pool");
const migrate = require("./migrate");
const { hashPassword } = require("../lib/auth");
const importPhotos = require("../scripts/import-photos");

// Mots de passe de départ : à changer dans l'admin (Équipe) dès la mise en service.
const STAFF = [
  { name: "Admin", username: "admin", password: process.env.ADMIN_PASSWORD || "admin707", role: "admin", floor: null },
  { name: "Serveur terrasse 1", username: "serveur1", password: "707707", role: "serveur", floor: 1 },
  { name: "Serveur terrasse 2", username: "serveur2", password: "707707", role: "serveur", floor: 2 },
  { name: "Serveur terrasse 3", username: "serveur3", password: "707707", role: "serveur", floor: 3 },
  { name: "Cuisine", username: "cuisine", password: "707707", role: "cuisine", floor: null },
  { name: "Bar", username: "bar", password: "707707", role: "bar", floor: null },
  { name: "Chef de terrain", username: "terrain", password: "707707", role: "terrain", floor: null },
];

async function main() {
  await migrate();
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM products");
  if (n > 0) {
    console.log("La base contient déjà un menu : rien à faire.");
    return;
  }
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(fs.readFileSync(path.join(__dirname, "seed.sql"), "utf8"));
    for (const s of STAFF) {
      await db.query(
        `INSERT INTO staff (name, username, password_hash, role, floor_id) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (username) DO NOTHING`,
        [s.name, s.username, hashPassword(s.password), s.role, s.floor]);
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    db.release();
  }
  console.log(`Menu de départ installé (${await importPhotos()} photos).`);
  console.log("Comptes (à changer dans Admin → Équipe) :");
  STAFF.forEach(s => console.log(`  ${s.username.padEnd(9)} / ${s.password.padEnd(9)} ${s.role}${s.floor ? " · terrasse " + s.floor : ""}`));
}

main()
  .catch(err => { console.error("Erreur :", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
