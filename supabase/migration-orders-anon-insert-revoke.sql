-- #434 follow-up: remove anon direct INSERT on orders / order_items.
--
-- After this runs, table-side orders can only be written by the Next.js server
-- (POST /api/orders, service role), which re-prices every line from the menu.
-- anon SELECT (used by staff realtime screens) is NOT changed.
--
-- execution: manual_sql_editor (Founder applies it in the Supabase SQL Editor).
-- Order: deploy the app that prices on the server FIRST, verify, then run this.
-- Rollback: supabase/rollbacks/orders-anon-insert-revoke.sql
-- Plan: docs/plans/2026-10-15-orders-anon-insert-revoke.md

BEGIN;

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_insert_orders" ON orders;
DROP POLICY IF EXISTS "anon_insert_order_items" ON order_items;

-- Belt and braces: even if a permissive INSERT policy is re-added later,
-- the browser roles hold no INSERT privilege on these tables.
REVOKE INSERT ON TABLE orders FROM anon, authenticated;
REVOKE INSERT ON TABLE order_items FROM anon, authenticated;

INSERT INTO schema_migrations (version, name)
VALUES ('20261015-orders-anon-insert-revoke', 'migration-orders-anon-insert-revoke.sql')
ON CONFLICT (version) DO NOTHING;

COMMIT;
