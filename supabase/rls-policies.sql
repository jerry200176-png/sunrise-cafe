-- Baseline RLS reference (keep in sync with migrations).
-- Production applies incremental migrations — do NOT re-run this file alone after hardenings.
--
-- Current intent (2026-07-15):
--   branches / rooms / settings → anon SELECT only (migration-rls-catalog-read-only.sql)
--   reservations → anon none (migration-rls-reservations-insert-only.sql)
--   Mutations → Next.js APIs with SUPABASE_SERVICE_ROLE_KEY

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon all branches" ON branches;
DROP POLICY IF EXISTS "Allow anon read branches" ON branches;
DROP POLICY IF EXISTS "Allow anon select branches" ON branches;
CREATE POLICY "Allow anon select branches" ON branches
  FOR SELECT TO anon USING (true);

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon all rooms" ON rooms;
DROP POLICY IF EXISTS "Allow anon read rooms" ON rooms;
DROP POLICY IF EXISTS "Allow anon select rooms" ON rooms;
CREATE POLICY "Allow anon select rooms" ON rooms
  FOR SELECT TO anon USING (true);

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon all reservations" ON reservations;
DROP POLICY IF EXISTS "Allow anon insert reservations" ON reservations;
DROP POLICY IF EXISTS "Allow anon select reservations" ON reservations;
-- No anon policies on reservations; service_role via Next.js APIs.

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon all settings" ON settings;
DROP POLICY IF EXISTS "Allow anon read settings" ON settings;
DROP POLICY IF EXISTS "Allow anon select settings" ON settings;
CREATE POLICY "Allow anon select settings" ON settings
  FOR SELECT TO anon USING (true);
