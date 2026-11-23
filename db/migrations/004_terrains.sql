-- 004 : réservation des terrains de foot et rôle « chef de terrain »
ALTER TABLE staff DROP CONSTRAINT staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check CHECK (role IN ('serveur', 'cuisine', 'bar', 'admin', 'terrain'));

CREATE TABLE pitches (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  position   INT NOT NULL DEFAULT 0,
  open_hour  INT NOT NULL DEFAULT 9  CHECK (open_hour BETWEEN 0 AND 23),
  close_hour INT NOT NULL DEFAULT 24 CHECK (close_hour BETWEEN 1 AND 24),
  CHECK (close_hour > open_hour)
);
INSERT INTO pitches (name, position) VALUES ('Terrain 1', 1), ('Terrain 2', 2), ('Terrain 3', 3);

-- Un créneau = une heure. Il n'est pris (éteint) qu'une fois confirmé par le chef de terrain.
CREATE TABLE reservations (
  id         SERIAL PRIMARY KEY,
  pitch_id   INT NOT NULL REFERENCES pitches(id),
  client_id  INT NOT NULL REFERENCES clients(id),
  day        DATE NOT NULL,
  hour       INT NOT NULL CHECK (hour BETWEEN 0 AND 23),
  status     TEXT NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente', 'confirmee', 'refusee', 'annulee')),
  handled_by INT REFERENCES staff(id),
  handled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Impossible d'avoir deux matchs confirmés sur le même créneau
CREATE UNIQUE INDEX reservations_one_match ON reservations (pitch_id, day, hour) WHERE status = 'confirmee';
CREATE UNIQUE INDEX reservations_one_request ON reservations (client_id, pitch_id, day, hour) WHERE status = 'en_attente';
CREATE INDEX reservations_day ON reservations (day, status);
CREATE INDEX reservations_client ON reservations (client_id, day);
