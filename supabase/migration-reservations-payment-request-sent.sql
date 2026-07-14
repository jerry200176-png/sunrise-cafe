-- 繳費通知是否已推播給客人（避免確認／改價／手動按鈕重複送同一則）
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS payment_request_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN reservations.payment_request_sent_at IS
  '客人 Bot 訂金繳費通知最近一次成功推播時間；非空則自動流程不再重送';
