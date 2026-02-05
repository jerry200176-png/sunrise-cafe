-- Phase 1: reservations 擴充 email、booking_code，status 對齊
-- 在 Supabase Dashboard → SQL Editor 執行

-- 1. 新增欄位
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS booking_code TEXT;

-- 2. 既有資料補 booking_code（8 碼，以 id 產生避免重複）
UPDATE reservations
SET booking_code = upper(substring(md5(id::text), 1, 8))
WHERE booking_code IS NULL;

-- 3. 設為 NOT NULL 並加 UNIQUE（若無資料可先設 DEFAULT 再改）
ALTER TABLE reservations ALTER COLUMN booking_code SET DEFAULT upper(substring(md5(gen_random_uuid()::text), 1, 8));
UPDATE reservations SET booking_code = upper(substring(md5(id::text), 1, 8)) WHERE booking_code IS NULL;
ALTER TABLE reservations ALTER COLUMN booking_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_booking_code ON reservations(booking_code);

-- 4. 擴充 status：加入 pending, confirmed, checked_in, cancelled, completed
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
UPDATE reservations SET status = 'confirmed' WHERE status = 'reserved';
UPDATE reservations SET status = 'completed' WHERE status = 'paid';
ALTER TABLE reservations ADD CONSTRAINT reservations_status_check
  CHECK (status IN ('pending', 'confirmed', 'checked_in', 'cancelled', 'completed'));
ALTER TABLE reservations ALTER COLUMN status SET DEFAULT 'confirmed';
