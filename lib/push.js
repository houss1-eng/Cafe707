// Notifications Web Push : elles arrivent sur l'écran du téléphone même quand l'app est fermée.
// Les clés VAPID sont créées une fois et gardées dans settings (ou VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).
// Les envois sont attendus avant de répondre : sur Vercel, rien ne tourne après la réponse.
const webpush = require("web-push");
const pool = require("../db/pool");

let keys = null;   // simple cache : la vraie valeur est en base
async function vapidKeys() {
  if (keys) return keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    return keys;
  }
  const fresh = webpush.generateVAPIDKeys();
  // Deux instances en même temps : la première écrit, toutes relisent la même paire
  await pool.query(
    "UPDATE settings SET vapid_public = $1, vapid_private = $2 WHERE id = 1 AND vapid_public IS NULL",
    [fresh.publicKey, fresh.privateKey]);
  const { rows: [s] } = await pool.query("SELECT vapid_public, vapid_private FROM settings WHERE id = 1");
  keys = { publicKey: s.vapid_public, privateKey: s.vapid_private };
  return keys;
}

const publicKey = async () => (await vapidKeys()).publicKey;

async function subscribe(kind, subjectId, sub) {
  const endpoint = String((sub || {}).endpoint || "");
  const { p256dh, auth } = (sub || {}).keys || {};
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth || String(p256dh).length > 200 || String(auth).length > 100) {
    return false;
  }
  // Même téléphone, autre compte : l'abonnement change de propriétaire
  await pool.query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, kind, subject_id) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = $2, auth = $3, kind = $4, subject_id = $5, created_at = now()`,
    [endpoint, String(p256dh), String(auth), kind, subjectId]);
  return true;
}

const unsubscribe = (endpoint) => pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [String(endpoint || "")]);

// payload : { title, body, url, tag }
async function sendTo(subs, payload) {
  if (!subs.length) return;
  try {
    const k = await vapidKeys();
    const options = {
      vapidDetails: { subject: process.env.VAPID_SUBJECT || "mailto:contact@707.tn", publicKey: k.publicKey, privateKey: k.privateKey },
      TTL: 3600, urgency: "high", timeout: 4000,
    };
    const body = JSON.stringify(payload);
    const results = await Promise.allSettled(subs.map(s =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, options)));
    // Abonnement expiré ou retiré par le téléphone : on l'oublie
    const dead = subs.filter((s, i) => results[i].status === "rejected" && [404, 410].includes(results[i].reason.statusCode));
    if (dead.length) await pool.query("DELETE FROM push_subscriptions WHERE endpoint = ANY($1)", [dead.map(s => s.endpoint)]);
  } catch (err) {
    console.error("Notification non envoyée :", err.message);   // une notification ratée ne bloque jamais l'action
  }
}

async function toClient(clientId, payload) {
  if (!clientId) return;
  const { rows } = await pool.query(
    "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE kind = 'client' AND subject_id = $1", [clientId]).catch(() => ({ rows: [] }));
  await sendTo(rows, { url: "/", ...payload });
}

// roles : ["serveur"], floorId : seulement les serveurs de cette terrasse
async function toStaff({ roles, floorId = null }, payload) {
  const { rows } = await pool.query(
    `SELECT ps.endpoint, ps.p256dh, ps.auth, st.role FROM push_subscriptions ps JOIN staff st ON st.id = ps.subject_id
      WHERE ps.kind = 'staff' AND st.active AND st.role = ANY($1)
        AND (st.role <> 'serveur' OR $2::int IS NULL OR st.floor_id = $2)`, [roles, floorId]).catch(() => ({ rows: [] }));
  const PAGE = { serveur: "/serveur.html", cuisine: "/cuisine.html", bar: "/cuisine.html", terrain: "/terrain.html", admin: "/admin.html" };
  await Promise.all(roles.map(role => sendTo(rows.filter(r => r.role === role), { url: PAGE[role], ...payload })));
}

module.exports = { publicKey, subscribe, unsubscribe, toClient, toStaff };
