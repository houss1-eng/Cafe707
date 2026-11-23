-- 003 : le café est disponible ou non (bouton de l'admin). Une seule ligne.
CREATE TABLE settings (
  id         INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_open    BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by INT REFERENCES staff(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO settings (id) VALUES (1);
