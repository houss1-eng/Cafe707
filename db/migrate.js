// Applique les migrations (db/migrations/NNN_*.sql) pas encore passées. Sans perte de données.
// Lancé au démarrage du serveur, ou à la main : npm run db:migrate
require("dotenv").config({ quiet: true });   // avant pool : la connexion lit DATABASE_URL
const fs = require("fs");
const path = require("path");
const pool = require("./pool");

async function migrate() {
  const db = await pool.connect();
  try {
    // Verrou : deux instances qui démarrent en même temps ne migrent pas deux fois
    await db.query("SELECT pg_advisory_lock(707)");
    await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const { rows } = await db.query("SELECT name FROM schema_migrations");
    const done = new Set(rows.map(r => r.name));
    const dir = path.join(__dirname, "migrations");
    const files = fs.readdirSync(dir).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      await db.query("BEGIN");
      try {
        await db.query(fs.readFileSync(path.join(dir, f), "utf8"));
        await db.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
        await db.query("COMMIT");
        console.log(`Migration appliquée : ${f}`);
      } catch (err) {
        await db.query("ROLLBACK");
        throw new Error(`Migration ${f} : ${err.message}`);
      }
    }
  } finally {
    await db.query("SELECT pg_advisory_unlock(707)").catch(() => {});
    db.release();
  }
}

module.exports = migrate;

if (require.main === module) {
  migrate()
    .then(() => console.log("Base à jour."))
    .catch(err => { console.error(err.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
