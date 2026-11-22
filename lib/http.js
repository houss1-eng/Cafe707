class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Évite les try/catch dans chaque route : les erreurs vont au gestionnaire d'erreurs
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Les prix sont calculés en millimes (entiers) pour éviter les erreurs d'arrondi.
const toMil = (v) => Math.round(Number(v) * 1000);
const toDT = (m) => m / 1000;
// 1 point par DT (partie entière du prix unitaire)
const pointsOf = (unitMil) => Math.floor(unitMil / 1000);

module.exports = { HttpError, wrap, toMil, toDT, pointsOf };
