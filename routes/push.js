// Abonnement aux notifications Web Push (client ou personnel)
const express = require("express");
const { HttpError, wrap } = require("../lib/http");
const { sessionFor } = require("../lib/auth");
const push = require("../lib/push");

const router = express.Router();

router.get("/push/key", wrap(async (req, res) => {
  res.json({ key: await push.publicKey() });
}));

// as : "client" ou "staff" (le jeton envoyé doit être une session de ce type)
router.post("/push/subscribe", wrap(async (req, res) => {
  const { as, subscription } = req.body || {};
  if (!["client", "staff"].includes(as)) throw new HttpError(400, "Demande invalide");
  const id = await sessionFor(req, as);
  if (!id) throw new HttpError(401, "Connecte-toi d'abord");
  if (!(await push.subscribe(as, id, subscription))) throw new HttpError(400, "Abonnement invalide");
  res.status(201).json({ ok: true });
}));

// Déconnexion ou notifications coupées sur ce téléphone
router.post("/push/unsubscribe", wrap(async (req, res) => {
  await push.unsubscribe((req.body || {}).endpoint);
  res.json({ ok: true });
}));

module.exports = router;
