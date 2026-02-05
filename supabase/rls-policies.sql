-- Sheng Coffee 包廂預約系統 - RLS 政策
-- 在 Supabase Dashboard → SQL Editor 執行（建議在 schema.sql 之後執行）

-- branches：允許匿名讀取、新增、更新、刪除（後台管理）
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon read branches" ON branches;
DROP POLICY IF EXISTS "Allow anon all branches" ON branches;
CREATE POLICY "Allow anon all branches" ON branches
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- rooms：允許匿名讀取、新增、更新、刪除
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon all rooms" ON rooms;
CREATE POLICY "Allow anon all rooms" ON rooms
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- reservations：允許匿名讀取、新增、更新、刪除
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon all reservations" ON reservations;
CREATE POLICY "Allow anon all reservations" ON reservations
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- settings：允許匿名讀取與更新
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon all settings" ON settings;
CREATE POLICY "Allow anon all settings" ON settings
  FOR ALL TO anon USING (true) WITH CHECK (true);
