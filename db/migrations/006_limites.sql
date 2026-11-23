-- 006 : limites anti-abus en base (mots de passe, SMS).
-- Sur Vercel, chaque requête peut tourner sur une instance différente : la mémoire du serveur ne suffit pas.
CREATE TABLE rate_limits (
  key      TEXT PRIMARY KEY,
  count    INT NOT NULL,
  reset_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX rate_limits_reset ON rate_limits (reset_at);
