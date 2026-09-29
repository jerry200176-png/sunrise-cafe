-- 後台標記已付訂金時記錄匯款日期與帳號末五碼，供之後對銀行帳。
-- Additive only; both columns nullable, no data is modified.
-- Rollback (after reverting the code that writes them):
--   ALTER TABLE reservations DROP CONSTRAINT reservations_deposit_last_five_format;
--   ALTER TABLE reservations DROP COLUMN deposit_paid_on, DROP COLUMN deposit_last_five;
--   DELETE FROM schema_migrations WHERE version = '20260929-reservations-deposit-transfer-info';
BEGIN;

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS deposit_paid_on date,
  ADD COLUMN IF NOT EXISTS deposit_last_five text;

ALTER TABLE reservations
  DROP CONSTRAINT IF EXISTS reservations_deposit_last_five_format;

ALTER TABLE reservations
  ADD CONSTRAINT reservations_deposit_last_five_format
  CHECK (deposit_last_five IS NULL OR deposit_last_five ~ '^\d{5}$');

INSERT INTO schema_migrations (version, name)
VALUES ('20260929-reservations-deposit-transfer-info', 'migration-reservations-deposit-transfer-info.sql')
ON CONFLICT (version) DO NOTHING;

COMMIT;
