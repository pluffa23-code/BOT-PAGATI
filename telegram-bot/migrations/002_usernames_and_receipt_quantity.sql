CREATE TABLE IF NOT EXISTS telegram_users (
  telegram_user_id text PRIMARY KEY,
  username text,
  first_name text,
  last_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE telegram_receipts
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'telegram_receipts_quantity_positive'
  ) THEN
    ALTER TABLE telegram_receipts
      ADD CONSTRAINT telegram_receipts_quantity_positive CHECK (quantity > 0);
  END IF;
END $$;
