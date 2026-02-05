-- Sheng Coffee 包廂預約系統 - Supabase Schema
-- 在 Supabase Dashboard → SQL Editor 執行此腳本
-- 注意：會 DROP reservations 表並重建，現有訂位資料會遺失，請先備份。

-- 1. 分店（若不存在則建立；若已存在則僅加欄位）
CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS open_time TIME DEFAULT '09:00';
ALTER TABLE branches ADD COLUMN IF NOT EXISTS close_time TIME DEFAULT '21:00';

-- 2. 包廂（每家分店底下的空間；平日/假日分開定價）
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT,
  capacity INTEGER NOT NULL,
  price_weekday NUMERIC NOT NULL DEFAULT 0,
  price_weekend NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rooms_branch_id ON rooms(branch_id);

-- 3. 訂位記錄（room + 時段 + 總價 + booking_code + email；status: pending, confirmed, checked_in, cancelled, completed）
DROP TABLE IF EXISTS reservations;
CREATE TABLE reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'checked_in', 'cancelled', 'completed')),
  total_price NUMERIC,
  guest_count INTEGER,
  notes TEXT,
  booking_code TEXT NOT NULL UNIQUE DEFAULT upper(substring(md5(gen_random_uuid()::text), 1, 8)),
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_end_after_start CHECK (end_time > start_time)
);
CREATE INDEX idx_reservations_room_time ON reservations(room_id, start_time, end_time);
CREATE UNIQUE INDEX idx_reservations_booking_code ON reservations(booking_code);

-- 4. 系統設定（維持不變；若尚未建立則建立）
CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY DEFAULT 'app',
  current_branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO settings (id, current_branch_id) VALUES ('app', NULL)
ON CONFLICT (id) DO NOTHING;

-- 5. Realtime：訂位表即時更新
ALTER PUBLICATION supabase_realtime ADD TABLE reservations;
