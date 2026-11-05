-- Local PG scenario test for migration-orders-anon-insert-revoke.sql and its rollback.
-- Run with scripts/test-orders-rls-sql.sh (throwaway cluster; never production).
\set ON_ERROR_STOP on

-- Supabase-like roles and a minimal fixture in the pre-migration state
-- (policies as supabase/migration-booking-meals.sql left them).
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE TABLE schema_migrations (version text PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  table_id uuid,
  status text NOT NULL DEFAULT 'pending',
  total_amount numeric NOT NULL DEFAULT 0,
  notes text,
  reservation_id uuid,
  paid_at timestamptz
);
CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  served_at timestamptz
);
GRANT ALL ON orders, order_items, schema_migrations TO anon, authenticated, service_role;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_orders" ON orders FOR SELECT TO anon USING (reservation_id IS NULL);
CREATE POLICY "anon_read_order_items" ON order_items FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND orders.reservation_id IS NULL));
CREATE POLICY "anon_insert_orders" ON orders FOR INSERT TO anon WITH CHECK (reservation_id IS NULL AND paid_at IS NULL);
CREATE POLICY "anon_insert_order_items" ON order_items FOR INSERT TO anon
  WITH CHECK (served_at IS NULL AND EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND orders.reservation_id IS NULL));
CREATE POLICY "service_all_orders" ON orders FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_order_items" ON order_items FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Helper: does an INSERT as the given role succeed?
CREATE FUNCTION pg_temp.try_insert(p_role text, p_order uuid) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  INSERT INTO orders (id, branch_id, total_amount) VALUES (p_order, gen_random_uuid(), 1);
  INSERT INTO order_items (order_id, item_name, unit_price) VALUES (p_order, 'x', 1);
  RESET ROLE;
  RETURN true;
EXCEPTION WHEN insufficient_privilege THEN
  RESET ROLE;
  RETURN false;
END $$;
CREATE FUNCTION pg_temp.assert(p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'ASSERT FAILED: %', p_msg; END IF;
  RAISE NOTICE 'ok - %', p_msg;
END $$;

-- Scenario 0: before migration, anon can insert directly (the hole).
SELECT pg_temp.assert(pg_temp.try_insert('anon', gen_random_uuid()), 'pre-migration: anon direct insert succeeds');

-- Scenario 1: apply migration.
\i supabase/migration-orders-anon-insert-revoke.sql
SELECT pg_temp.assert(NOT pg_temp.try_insert('anon', gen_random_uuid()), 'migrated: anon direct insert is rejected');
SELECT pg_temp.assert(NOT pg_temp.try_insert('authenticated', gen_random_uuid()), 'migrated: authenticated direct insert is rejected');
SELECT pg_temp.assert(pg_temp.try_insert('service_role', gen_random_uuid()), 'migrated: service_role insert still works');
SET ROLE anon;
SELECT pg_temp.assert((SELECT count(*) FROM orders) >= 2, 'migrated: anon SELECT (realtime screens) unchanged');
SELECT pg_temp.assert((SELECT count(*) FROM order_items) >= 2, 'migrated: anon SELECT on order_items unchanged');
RESET ROLE;
SELECT pg_temp.assert(NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename IN ('orders','order_items') AND cmd = 'INSERT' AND 'anon' = ANY(roles)), 'migrated: no anon INSERT policy remains');
SELECT pg_temp.assert(EXISTS (SELECT 1 FROM schema_migrations WHERE version = '20261015-orders-anon-insert-revoke'), 'migrated: ledger row recorded');

-- Scenario 2: re-running is a no-op (idempotent).
\i supabase/migration-orders-anon-insert-revoke.sql
SELECT pg_temp.assert(NOT pg_temp.try_insert('anon', gen_random_uuid()), 'rerun: still rejected');

-- Scenario 3: rollback restores the previous behaviour, data untouched.
CREATE TEMP TABLE before_rollback AS SELECT count(*) AS n FROM orders;
\i supabase/rollbacks/orders-anon-insert-revoke.sql
SELECT pg_temp.assert((SELECT count(*) FROM orders) = (SELECT n FROM before_rollback), 'rollback: no order rows changed');
SELECT pg_temp.assert(pg_temp.try_insert('anon', gen_random_uuid()), 'rollback: anon direct insert works again');
SELECT pg_temp.assert(NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '20261015-orders-anon-insert-revoke'), 'rollback: ledger row removed');

-- Scenario 4: forward again after rollback.
\i supabase/migration-orders-anon-insert-revoke.sql
SELECT pg_temp.assert(NOT pg_temp.try_insert('anon', gen_random_uuid()), 're-apply: anon direct insert rejected again');
