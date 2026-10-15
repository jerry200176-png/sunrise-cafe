-- 本機測試用：只模擬 migration-reservation-settlements.sql 會碰到的正式環境表與欄位。
-- 只給 scripts/test-settlement-sql.sh 在一個全新、拋棄式的本機資料庫使用；不要在任何 Supabase 專案執行。
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE branches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
CREATE TABLE rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_weekday numeric,
  price_weekend numeric
);
CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id),
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  total_price numeric,
  is_deposit_paid boolean DEFAULT false,
  deposit_status text DEFAULT 'pending',
  booking_code text,
  payment_intent_id text,
  CONSTRAINT reservations_no_overlap_excl EXCLUDE USING gist (
    room_id WITH =, tstzrange(start_time, end_time, '[)') WITH &&
  ) WHERE (status IS DISTINCT FROM 'cancelled')
);
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid UNIQUE REFERENCES reservations(id),
  total_amount numeric DEFAULT 0,
  paid_at timestamptz,
  status text DEFAULT 'pending'
);
-- 盤點查詢（supabase/queries/legacy-refunded-deposit-inventory.sql）用到的既有表
CREATE TABLE payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_pi_id text UNIQUE NOT NULL,
  reservation_id uuid NOT NULL REFERENCES reservations(id),
  amount integer NOT NULL,
  status text NOT NULL DEFAULT 'pending'
);
CREATE TABLE ops_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts timestamptz NOT NULL DEFAULT now(),
  domain text NOT NULL,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE schema_migrations (version text PRIMARY KEY, name text, applied_at timestamptz DEFAULT now());

-- 模擬 Supabase 預設：新表對 anon／authenticated／service_role 都有權限，靠 RLS 擋
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
