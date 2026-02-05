-- 新增 is_notified 欄位：用於明日預約提醒，發送後標記為 true 避免重複發送
-- 在 Supabase Dashboard → SQL Editor 執行

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS is_notified BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN reservations.is_notified IS '是否已發送明日提醒';
