const pool = require("../db/pool");
const { bizDay, TODAY } = require("./day");

// Statuts d'une commande, dans l'ordre du service
const STATUSES = ["nouvelle", "en_preparation", "servie", "payee", "annulee"];

// Passages autorisés (le serveur avance la commande, ou l'annule avant qu'elle soit servie)
const NEXT = {
  nouvelle: ["en_preparation", "annulee"],
  en_preparation: ["servie", "annulee"],
  servie: ["payee"],
  payee: [],
  annulee: [],
};

// Commandes avec leurs lignes.
// scope : active (en cours) | done (terminées) | today (tout aujourd'hui) | client (historique) | day (une journée)
async function listOrders({ floorId = null, scope = "active", clientId = null, day = null, limit = 300 }) {
  const where = ["($1::int IS NULL OR o.floor_id = $1)", "($2::int IS NULL OR o.client_id = $2)"];
  if (scope === "active") where.push(`o.status IN ('nouvelle', 'en_preparation', 'servie')`);
  if (scope === "done") where.push(`o.status IN ('payee', 'annulee')`);
  if (["active", "done", "today"].includes(scope)) where.push(`${bizDay("o.created_at")} = ${TODAY}`);
  if (scope === "day") where.push(`${bizDay("o.created_at")} = $4::date`);

  const { rows } = await pool.query(
    `SELECT o.id, o.floor_id, f.name AS floor_name, o.table_no, o.payment,
            o.subtotal::float AS subtotal, o.discount::float AS discount, o.total::float AS total,
            o.points_used, o.points_earned, o.status, (o.ready_at IS NOT NULL) AS ready,
            o.created_at, o.updated_at, o.paid_method, o.paid_at,
            c.name AS client_name, c.phone AS client_phone,
            st.name AS handled_by, pb.name AS paid_by,
            (SELECT json_agg(json_build_object(
                      'name', p.name, 'icon', p.icon, 'qty', oi.qty, 'unit', oi.unit_price::float,
                      'options', oi.options, 'station', oi.station, 'ready', oi.ready_at IS NOT NULL) ORDER BY oi.id)
               FROM order_items oi JOIN products p ON p.id = oi.product_id
              WHERE oi.order_id = o.id) AS items
       FROM orders o
       JOIN floors f ON f.id = o.floor_id
       LEFT JOIN clients c ON c.id = o.client_id
       LEFT JOIN staff st ON st.id = o.handled_by
       LEFT JOIN staff pb ON pb.id = o.paid_by
      WHERE ${where.join(" AND ")}
      ORDER BY o.created_at DESC
      LIMIT $3`, [floorId, clientId, limit, ...(scope === "day" ? [day] : [])]);
  return rows;
}

module.exports = { STATUSES, NEXT, listOrders };
