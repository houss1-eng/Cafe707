-- 001 : schéma complet du 707 (PostgreSQL)

-- Terrasses, avec leurs numéros de table (table_from à table_to)
CREATE TABLE floors (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  table_from INT  NOT NULL DEFAULT 1 CHECK (table_from >= 1),
  table_to   INT  NOT NULL DEFAULT 20,
  position   INT  NOT NULL DEFAULT 0,
  CHECK (table_to >= table_from AND table_to <= 999)
);

-- Catégories : station = où se prépare la catégorie (écran cuisine ou bar)
CREATE TABLE categories (
  key      TEXT PRIMARY KEY,
  label    TEXT NOT NULL,
  title    TEXT NOT NULL,
  station  TEXT NOT NULL DEFAULT 'cuisine' CHECK (station IN ('cuisine', 'bar')),
  position INT  NOT NULL DEFAULT 0
);

-- Ordre d'affichage des sous-catégories d'une catégorie
CREATE TABLE subcategories (
  id           SERIAL PRIMARY KEY,
  category_key TEXT NOT NULL REFERENCES categories(key) ON DELETE CASCADE ON UPDATE CASCADE,
  name         TEXT NOT NULL,
  position     INT  NOT NULL DEFAULT 0,
  UNIQUE (category_key, name)
);

-- Photos des produits (en base : rien à perdre si l'hébergeur efface ses disques)
CREATE TABLE images (
  id         SERIAL PRIMARY KEY,
  mime       TEXT  NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE products_id_seq START 100;
CREATE TABLE products (
  id           INT PRIMARY KEY DEFAULT nextval('products_id_seq'),
  name         TEXT NOT NULL,
  price        NUMERIC(8,2) NOT NULL CHECK (price >= 0),
  kcal         INT  NOT NULL DEFAULT 0,
  category_key TEXT NOT NULL REFERENCES categories(key) ON UPDATE CASCADE,
  subcategory  TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL DEFAULT 'simple' CHECK (kind IN ('simple', 'pizza')),
  icon         TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  badge        TEXT,
  image_id     INT REFERENCES images(id) ON DELETE SET NULL,
  favorite     BOOLEAN NOT NULL DEFAULT FALSE,
  sold_out     BOOLEAN NOT NULL DEFAULT FALSE,
  archived     BOOLEAN NOT NULL DEFAULT FALSE,   -- retiré du menu (gardé pour l'historique)
  stock        INT CHECK (stock >= 0),           -- NULL = pas de suivi de stock
  position     INT NOT NULL DEFAULT 0
);
ALTER SEQUENCE products_id_seq OWNED BY products.id;

CREATE TABLE option_groups (
  id         SERIAL PRIMARY KEY,
  product_id INT  NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  single     BOOLEAN NOT NULL DEFAULT FALSE,     -- TRUE = un seul choix (ex. sauce)
  position   INT  NOT NULL DEFAULT 0
);

CREATE TABLE options (
  id       TEXT PRIMARY KEY,
  group_id INT  NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  price    NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  kcal     INT  NOT NULL DEFAULT 0,
  position INT  NOT NULL DEFAULT 0
);

-- Clients : identifiés par leur numéro (code SMS)
CREATE TABLE clients (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT UNIQUE,
  points     INT  NOT NULL DEFAULT 0 CHECK (points >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Codes SMS de connexion (seul le hash du code est gardé)
CREATE TABLE otp_codes (
  phone      TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts   INT  NOT NULL DEFAULT 0,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sends      INT  NOT NULL DEFAULT 1,            -- envois dans l'heure en cours
  window_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Personnel : serveur (une terrasse), cuisine, bar, admin
CREATE TABLE staff (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('serveur', 'cuisine', 'bar', 'admin')),
  floor_id      INT REFERENCES floors(id),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (role <> 'serveur' OR floor_id IS NOT NULL)
);

CREATE TABLE orders (
  id            SERIAL PRIMARY KEY,
  client_id     INT REFERENCES clients(id),
  floor_id      INT NOT NULL REFERENCES floors(id),
  table_no      TEXT NOT NULL,
  payment       TEXT NOT NULL CHECK (payment IN ('Espèces', 'Carte')),
  subtotal      NUMERIC(10,2) NOT NULL,
  discount      NUMERIC(10,2) NOT NULL DEFAULT 0,  -- payé en points
  total         NUMERIC(10,2) NOT NULL,            -- à encaisser
  points_used   INT NOT NULL DEFAULT 0,
  points_earned INT NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'nouvelle'
                CHECK (status IN ('nouvelle', 'en_preparation', 'servie', 'payee', 'annulee')),
  ready_at      TIMESTAMPTZ,                       -- cuisine + bar ont tout préparé
  handled_by    INT REFERENCES staff(id),
  paid_by       INT REFERENCES staff(id),
  paid_method   TEXT CHECK (paid_method IN ('Espèces', 'Carte')),
  paid_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id         SERIAL PRIMARY KEY,
  order_id   INT  NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INT  NOT NULL REFERENCES products(id),
  qty        INT  NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(8,2) NOT NULL,
  options    JSONB NOT NULL DEFAULT '[]',          -- [{id, name, price}]
  station    TEXT NOT NULL DEFAULT 'cuisine' CHECK (station IN ('cuisine', 'bar')),
  ready_at   TIMESTAMPTZ
);

-- Appels serveur / demandes d'addition depuis une table
CREATE TABLE calls (
  id         SERIAL PRIMARY KEY,
  floor_id   INT  NOT NULL REFERENCES floors(id),
  table_no   TEXT NOT NULL,
  client_id  INT  REFERENCES clients(id),
  kind       TEXT NOT NULL CHECK (kind IN ('serveur', 'addition')),
  payment    TEXT CHECK (payment IN ('Espèces', 'Carte')),
  status     TEXT NOT NULL DEFAULT 'ouvert' CHECK (status IN ('ouvert', 'traite')),
  handled_by INT REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  handled_at TIMESTAMPTZ
);

-- Clôtures de caisse (une par journée)
CREATE TABLE closings (
  id           SERIAL PRIMARY KEY,
  business_day DATE NOT NULL UNIQUE,
  closed_by    INT  NOT NULL REFERENCES staff(id),
  totals       JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sessions (client ou personnel). On ne stocke que le hash du jeton.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('client', 'staff')),
  subject_id INT  NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX orders_client_idx ON orders (client_id, created_at DESC);
CREATE INDEX orders_floor_idx ON orders (floor_id, created_at DESC);
CREATE INDEX orders_created_idx ON orders (created_at);
CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX calls_open_idx ON calls (floor_id) WHERE status = 'ouvert';
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
