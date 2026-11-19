CREATE TABLE IF NOT EXISTS telegram_admins (
  telegram_user_id text PRIMARY KEY,
  is_super_admin boolean NOT NULL DEFAULT false,
  added_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_users (
  telegram_user_id text PRIMARY KEY,
  username text,
  first_name text,
  last_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_products (
  id serial PRIMARY KEY,
  name text NOT NULL,
  normalized_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS telegram_products_normalized_name_uq
  ON telegram_products (normalized_name);

CREATE TABLE IF NOT EXISTS telegram_receipts (
  id serial PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  vendor text NOT NULL,
  buyer text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  product_id integer NOT NULL REFERENCES telegram_products(id) ON DELETE RESTRICT,
  recorded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_receipts_created_at_idx
  ON telegram_receipts (created_at);
CREATE INDEX IF NOT EXISTS telegram_receipts_product_id_idx
  ON telegram_receipts (product_id);

CREATE TABLE IF NOT EXISTS telegram_productions (
  id serial PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  product_id integer NOT NULL REFERENCES telegram_products(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  employee text NOT NULL,
  recorded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_productions_created_at_idx
  ON telegram_productions (created_at);
CREATE INDEX IF NOT EXISTS telegram_productions_product_id_idx
  ON telegram_productions (product_id);

CREATE TABLE IF NOT EXISTS telegram_bot_sessions (
  telegram_user_id text PRIMARY KEY,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
