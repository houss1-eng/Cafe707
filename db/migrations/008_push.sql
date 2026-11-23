-- 008 : notifications Web Push (écran du téléphone, même app fermée).
-- Un abonnement = un navigateur d'un téléphone, rattaché à un client ou à un membre du personnel.
CREATE TABLE push_subscriptions (
  id         SERIAL PRIMARY KEY,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('client', 'staff')),
  subject_id INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_subject ON push_subscriptions (kind, subject_id);

-- Clés VAPID du serveur : créées automatiquement au premier besoin (rien à configurer sur l'hébergeur).
ALTER TABLE settings ADD COLUMN vapid_public TEXT, ADD COLUMN vapid_private TEXT;
