-- 候補一鍵確認：新增確認用 token，並擴充 status 允許值
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS confirm_token UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_confirm_token_idx ON waitlist (confirm_token);

ALTER TABLE waitlist DROP CONSTRAINT IF EXISTS waitlist_status_check;
ALTER TABLE waitlist ADD CONSTRAINT waitlist_status_check
  CHECK (status IN ('waiting', 'notified', 'expired', 'booked'));
