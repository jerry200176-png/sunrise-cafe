-- Market-parity Round 3–7 columns (safe to re-run)
-- Paste into Supabase Dashboard → SQL Editor → Run

-- D-1 guest attendance confirmation
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS guest_confirmed_at TIMESTAMPTZ;
COMMENT ON COLUMN reservations.guest_confirmed_at IS '客人透過 D-1 提醒確認準時到店的時間';

-- Second deposit nudge when deadline ≤6h
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS deposit_urgent_reminder_sent_at TIMESTAMPTZ;
COMMENT ON COLUMN reservations.deposit_urgent_reminder_sent_at IS
  '訂金期限 ≤6 小時迫近二次提醒已寄出時間';

-- Waitlist: staff marked phone call done
ALTER TABLE waitlist
  ADD COLUMN IF NOT EXISTS staff_called_at TIMESTAMPTZ;
COMMENT ON COLUMN waitlist.staff_called_at IS '店員標記已電話通知等位客人的時間';

-- Waitlist: one-shot staff LINE alert when guest needs call
ALTER TABLE waitlist
  ADD COLUMN IF NOT EXISTS staff_alerted_at TIMESTAMPTZ;
COMMENT ON COLUMN waitlist.staff_alerted_at IS
  '系統已推播「需電聯」到店員群組的時間（無 LINE 綁定時）';
