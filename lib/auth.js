const crypto = require("crypto");
const pool = require("../db/pool");
const { HttpError, wrap } = require("./http");
const limit = require("./limit");

// ---- Mots de passe (scrypt, intégré à Node) ----
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [algo, salt, hash] = String(stored).split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const ref = Buffer.from(hash, "hex");
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}

// Code personnel du client : 6 chiffres, montré une seule fois
const newClientCode = () => String(crypto.randomInt(0, 1e6)).padStart(6, "0");

// ---- Sessions : jeton aléatoire, seul son hash est en base ----
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const DURATION = { client: "180 days", staff: "12 hours" };

async function createSession(kind, subjectId) {
  const token = crypto.randomBytes(32).toString("hex");
  // Ménage à chaque connexion (pas de tâche de fond sur Vercel)
  await pool.query("DELETE FROM sessions WHERE expires_at < now()");
  await pool.query("DELETE FROM rate_limits WHERE reset_at < now()");
  await pool.query(
    `INSERT INTO sessions (token_hash, kind, subject_id, expires_at)
     VALUES ($1, $2, $3, now() + $4::interval)`,
    [sha(token), kind, subjectId, DURATION[kind]]);
  return token;
}

async function deleteSession(req) {
  const token = bearer(req);
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sha(token)]);
}

const bearer = (req) => {
  const h = req.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
};

async function sessionFor(req, kind) {
  const token = bearer(req);
  if (!token) return null;
  const { rows } = await pool.query(
    "SELECT subject_id FROM sessions WHERE token_hash = $1 AND kind = $2 AND expires_at > now()",
    [sha(token), kind]);
  return rows[0] ? rows[0].subject_id : null;
}

// req.client = { id, name, phone, points }
const requireClient = wrap(async (req, res, next) => {
  const id = await sessionFor(req, "client");
  if (!id) throw new HttpError(401, "Connecte-toi d'abord");
  const { rows } = await pool.query("SELECT id, name, phone, points FROM clients WHERE id = $1", [id]);
  if (!rows.length) throw new HttpError(401, "Connecte-toi d'abord");
  req.client = rows[0];
  next();
});

// req.staff = { id, name, username, role, floor_id, floor_name }
const requireStaff = (...roles) => wrap(async (req, res, next) => {
  const id = await sessionFor(req, "staff");
  if (!id) throw new HttpError(401, "Session expirée, reconnecte-toi");
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.username, s.role, s.floor_id, f.name AS floor_name
       FROM staff s LEFT JOIN floors f ON f.id = s.floor_id
      WHERE s.id = $1 AND s.active`, [id]);
  if (!rows.length) throw new HttpError(401, "Compte désactivé");
  if (roles.length && !roles.includes(rows[0].role)) throw new HttpError(403, "Accès réservé");
  req.staff = rows[0];
  next();
});

// Limite simple contre les essais de mots de passe : 10 échecs / 10 min par adresse
const loginKey = (req) => `login:${req.ip}`;
async function checkLoginRate(req) {
  if (await limit.countOf(loginKey(req)) >= 10) throw new HttpError(429, "Trop d'essais, réessaie dans quelques minutes");
}
const recordLoginFailure = (req) => limit.hit(loginKey(req), 600);
const clearLoginFailures = (req) => limit.clear(loginKey(req));

module.exports = {
  hashPassword, verifyPassword, newClientCode, createSession, deleteSession,
  requireClient, requireStaff, checkLoginRate, recordLoginFailure, clearLoginFailures,
};
