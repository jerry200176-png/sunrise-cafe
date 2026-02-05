-- Phase 1: reservations 表 RLS — anon 僅允許 INSERT（客人自助訂位）
-- 後端讀取/更新/刪除請使用 SUPABASE_SERVICE_ROLE_KEY
-- 在 Supabase Dashboard → SQL Editor 執行

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon all reservations" ON reservations;
DROP POLICY IF EXISTS "Allow anon insert reservations" ON reservations;
DROP POLICY IF EXISTS "Allow anon select reservations" ON reservations;

-- 不給 anon 任何 reservations 權限；所有讀寫經由 Next.js API 使用 service_role 執行
