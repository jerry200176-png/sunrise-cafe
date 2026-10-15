-- Rollback for supabase/migration-orders-anon-insert-revoke.sql.
-- Restores the anon INSERT privilege and the two INSERT policies exactly as
-- supabase/migration-booking-meals.sql last defined them. No data is touched.
-- Only run this if the server-side order path is broken AND a client that
-- inserts directly with the anon key has to keep working (none exists on
-- main as of 2026-10-15; the QR cart posts to /api/orders).

BEGIN;

GRANT INSERT ON TABLE orders TO anon, authenticated;
GRANT INSERT ON TABLE order_items TO anon, authenticated;

DROP POLICY IF EXISTS "anon_insert_orders" ON orders;
CREATE POLICY "anon_insert_orders" ON orders FOR INSERT TO anon
  WITH CHECK (reservation_id IS NULL AND paid_at IS NULL);

DROP POLICY IF EXISTS "anon_insert_order_items" ON order_items;
CREATE POLICY "anon_insert_order_items" ON order_items FOR INSERT TO anon
  WITH CHECK (served_at IS NULL AND EXISTS (
    SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND orders.reservation_id IS NULL
  ));

DELETE FROM schema_migrations WHERE version = '20261015-orders-anon-insert-revoke';

COMMIT;
