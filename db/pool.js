const { Pool } = require("pg");

// Connexion : DATABASE_URL dans .env, ex. postgres://postgres:motdepasse@localhost:5432/cafe707
// En ligne (Render, Neon, Railway…), la base exige souvent SSL : DATABASE_SSL=true
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DATABASE_POOL_MAX) || 10,
});

module.exports = pool;
