-- Migration: 20260908-deposit-approved-notified
-- DB-level atomic guarantee for payment approval notifications across serverless instances.

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS deposit_approved_notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_reservations_deposit_approved_notified
  ON reservations (deposit_approved_notified_at)
  WHERE deposit_approved_notified_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_events_payment_approved_unique
  ON ops_events ((detail->>'reservation_id'))
  WHERE action = 'payment.approved_notified';

INSERT INTO schema_migrations (version, name)
VALUES ('20260908-deposit-approved-notified', 'migration-deposit-approved-notified.sql')
ON CONFLICT (version) DO NOTHING;
