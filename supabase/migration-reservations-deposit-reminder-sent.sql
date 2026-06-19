-- 訂金到期提醒是否已發送（避免每次 cron 執行重複提醒）
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS deposit_reminder_sent_at TIMESTAMPTZ;
