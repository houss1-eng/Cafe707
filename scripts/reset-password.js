// Change le mot de passe d'un compte du personnel (ex. admin oublié) directement dans la base.
// Usage (PowerShell, adresse Neon directe) :
//   $env:DATABASE_URL="adresse-directe"; $env:DATABASE_SSL="true"; npm run reset-password -- admin nouveau-mot-de-passe
require("dotenv").config({ quiet: true });
const pool = require("../db/pool");
const { hashPassword } = require("../lib/auth");

async function main() {
  const [username = "", password = ""] = process.argv.slice(2);
  if (!username || password.length < 6) {
    console.error("Usage : npm run reset-password -- <identifiant> <mot-de-passe (6 caractères minimum)>");
    process.exitCode = 1;
    return;
  }
  const { rowCount } = await pool.query(
    "UPDATE staff SET password_hash = $1, active = true WHERE username = $2",
    [hashPassword(password), username.trim().toLowerCase()]);
  if (!rowCount) {
    console.error(`Aucun compte « ${username} » dans cette base.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Mot de passe de « ${username} » changé.`);
}

main()
  .catch((err) => { console.error("Erreur :", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
