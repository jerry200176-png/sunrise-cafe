-- 訂位表新增：人數、備註（可編輯用）
-- 在 Supabase Dashboard → SQL Editor 執行

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS guest_count INTEGER;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN reservations.guest_count IS '訂位人數';
COMMENT ON COLUMN reservations.notes IS '備註';
