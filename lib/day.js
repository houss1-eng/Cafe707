// Journée de travail du café : heure de Tunis, et la journée commence à DAY_START_HOUR (5 h par défaut).
// Une commande à 1 h du matin compte donc pour la soirée de la veille.
const TZ = /^[A-Za-z_]+\/[A-Za-z_]+$/.test(process.env.TZ_NAME || "") ? process.env.TZ_NAME : "Africa/Tunis";
const H = Math.min(12, Math.max(0, parseInt(process.env.DAY_START_HOUR ?? "5", 10) || 0));

// Expression SQL : journée de travail d'une colonne horodatée
const bizDay = (col) => `((${col} AT TIME ZONE '${TZ}') - interval '${H} hours')::date`;
const TODAY = bizDay("now()");

// "AAAA-MM-JJ" valide ?
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(Date.parse(s));

module.exports = { TZ, bizDay, TODAY, isDate };
