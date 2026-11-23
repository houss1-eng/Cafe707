const { Pool } = require("pg");

// Connexion : DATABASE_URL dans .env, ex. postgres://postgres:motdepasse@localhost:5432/cafe707
// En ligne (Render, Neon, Railway…), la base exige souvent SSL : DATABASE_SSL=true
// Sur Vercel, chaque instance garde très peu de connexions (utiliser l'adresse « pooled » de Neon).
const onVercel = Boolean(process.env.VERCEL);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DATABASE_POOL_MAX) || (onVercel ? 3 : 10),
  idleTimeoutMillis: onVercel ? 5000 : 10000,
  connectionTimeoutMillis: 15000,        // une base en veille met un moment à se réveiller
});
// Une connexion inactive coupée par la base ne doit pas arrêter le serveur
pool.on("error", (err) => console.error("Connexion base perdue :", err.message));

module.exports = pool;
