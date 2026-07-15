-- Second deposit nudge when deadline is ≤6h (after first 24h-window reminder)
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS deposit_urgent_reminder_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN reservations.deposit_urgent_reminder_sent_at IS
  '訂金期限 ≤6 小時迫近二次提醒已寄出時間';
