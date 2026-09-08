-- Migration: 20260908-deposit-approved-retry-key
-- Persist provider-level idempotency retry keys for payment approval LINE notifications.

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS deposit_approved_retry_key UUID,
  ADD COLUMN IF NOT EXISTS deposit_approved_guest_retry_key UUID,
  ADD COLUMN IF NOT EXISTS deposit_approved_retry_key_created_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_reservations_deposit_approved_retry_key
  ON reservations (deposit_approved_retry_key)
  WHERE deposit_approved_retry_key IS NOT NULL;

INSERT INTO schema_migrations (version, name)
VALUES ('20260908-deposit-approved-retry-key', 'migration-deposit-approved-retry-key.sql')
ON CONFLICT (version) DO NOTHING;
