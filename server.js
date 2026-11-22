require("dotenv").config({ quiet: true });
const path = require("path");
const os = require("os");
const express = require("express");
const pool = require("./db/pool");
const migrate = require("./db/migrate");
const { HttpError } = require("./lib/http");
const { PROVIDER } = require("./lib/sms");

const app = express();
// Derrière l'hébergeur (Render, Railway…) : la vraie adresse du client et le https
app.set("trust proxy", 1);
app.disable("x-powered-by");

// En ligne : tout en https
if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => (req.secure || req.path === "/api/health" ? next() : res.redirect(301, `https://${req.get("host")}${req.originalUrl}`)));
}
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
  });
  next();
});

// JSON léger partout, sauf l'envoi de photos (sa route a sa propre limite)
const smallJson = express.json({ limit: "50kb" });
app.use((req, res, next) => (req.path === "/api/admin/images" ? next() : smallJson(req, res, next)));
// Pages, scripts et styles : le navigateur revérifie à chaque visite (sinon une ancienne
// version en cache peut se mélanger à la nouvelle et casser la page). Images : 1 jour.
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res, file) {
    res.set("Cache-Control", /\.(html|js|css|json)$/.test(file) ? "no-cache" : "public, max-age=86400");
  },
}));

app.get("/api/health", async (req, res) => {
  try { await pool.query("SELECT 1"); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
});

// Espaces : client (/), serveur, cuisine/bar, admin
app.use("/api", require("./routes/menu"));
app.use("/api", require("./routes/client"));
app.use("/api", require("./routes/staff"));
app.use("/api", require("./routes/admin"));

// ---- Erreurs ----
app.use("/api", (req, res) => res.status(404).json({ error: "Route inconnue" }));
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "JSON invalide" });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Envoi trop lourd" });
  console.error(err);
  res.status(500).json({ error: "Erreur serveur" });
});

const PORT = Number(process.env.PORT) || 3000;

// Base à jour avant d'accepter des commandes, puis ménage des vieilles sessions chaque heure
migrate()
  .then(() => {
    if (process.env.NODE_ENV === "production" && PROVIDER === "console") {
      console.warn("ATTENTION : SMS_PROVIDER n'est pas configuré, les codes de connexion ne partent pas par SMS.");
    }
    setInterval(() => pool.query("DELETE FROM sessions WHERE expires_at < now()").catch(() => {}), 3600e3);
    // 0.0.0.0 : accessible depuis les téléphones du même Wi-Fi
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`707 en ligne : http://localhost:${PORT}`);
      if (process.env.NODE_ENV === "production") return;
      Object.values(os.networkInterfaces()).flat()
        .filter(i => i && i.family === "IPv4" && !i.internal)
        .forEach(i => {
          const base = `http://${i.address}:${PORT}`;
          console.log(`  client ${base}/   serveur ${base}/serveur.html   cuisine ${base}/cuisine.html   admin ${base}/admin.html`);
        });
    });
  })
  .catch(err => {
    console.error("Démarrage impossible :", err.message);
    process.exit(1);
  });
