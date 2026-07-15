-- Harden RLS: anon may SELECT branches/rooms/settings only.
-- Mutations must use SUPABASE_SERVICE_ROLE_KEY via Next.js admin APIs.
-- Apply in Supabase SQL Editor (or automation) after deploying code that uses
-- service-role headers for catalog writes (supabase-fetch.ts adminHeaders).

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon all branches" ON branches;
DROP POLICY IF EXISTS "Allow anon read branches" ON branches;
DROP POLICY IF EXISTS "Allow anon select branches" ON branches;
CREATE POLICY "Allow anon select branches" ON branches
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow anon all rooms" ON rooms;
DROP POLICY IF EXISTS "Allow anon read rooms" ON rooms;
DROP POLICY IF EXISTS "Allow anon select rooms" ON rooms;
CREATE POLICY "Allow anon select rooms" ON rooms
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow anon all settings" ON settings;
DROP POLICY IF EXISTS "Allow anon read settings" ON settings;
DROP POLICY IF EXISTS "Allow anon select settings" ON settings;
CREATE POLICY "Allow anon select settings" ON settings
  FOR SELECT TO anon USING (true);

INSERT INTO schema_migrations (version, name)
VALUES ('20260715-rls-catalog-read-only', 'migration-rls-catalog-read-only.sql')
ON CONFLICT (version) DO NOTHING;
