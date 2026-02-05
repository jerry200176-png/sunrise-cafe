-- Rooms: 新增 image_url 欄位，用於包廂照片
-- 在 Supabase SQL Editor 執行一次

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS image_url TEXT;
COMMENT ON COLUMN rooms.image_url IS '包廂照片 URL（可選）';

-- Rooms: 新增 image_url 欄位，用於包廂照片
-- 在 Supabase SQL Editor 執行一次

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS image_url TEXT;
COMMENT ON COLUMN rooms.image_url IS '包廂照片 URL（可選）';

