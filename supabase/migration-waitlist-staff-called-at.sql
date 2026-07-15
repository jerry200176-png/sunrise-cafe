-- Staff marked waitlist guest as phone-called (no LINE bind path)
ALTER TABLE waitlist
  ADD COLUMN IF NOT EXISTS staff_called_at TIMESTAMPTZ;

COMMENT ON COLUMN waitlist.staff_called_at IS '店員標記已電話通知等位客人的時間';
