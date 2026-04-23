-- 新增訂金付款備註欄位，供後台記錄匯款末五碼或 LINE Pay 截圖等資訊
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS deposit_payment_note text;
