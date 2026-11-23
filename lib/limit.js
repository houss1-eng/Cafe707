// Compteurs anti-abus partagés entre toutes les instances du serveur (table rate_limits).
const pool = require("../db/pool");

async function countOf(key) {
  const { rows } = await pool.query("SELECT count FROM rate_limits WHERE key = $1 AND reset_at > now()", [key]);
  return rows[0] ? rows[0].count : 0;
}

// Ajoute 1 au compteur (fenêtre de `seconds` secondes) et renvoie sa nouvelle valeur
async function hit(key, seconds) {
  const { rows } = await pool.query(
    `INSERT INTO rate_limits (key, count, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2))
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.reset_at > now() THEN rate_limits.count + 1 ELSE 1 END,
       reset_at = CASE WHEN rate_limits.reset_at > now() THEN rate_limits.reset_at ELSE EXCLUDED.reset_at END
     RETURNING count`, [key, seconds]);
  return rows[0].count;
}

const clear = (key) => pool.query("DELETE FROM rate_limits WHERE key = $1", [key]);

module.exports = { countOf, hit, clear };
