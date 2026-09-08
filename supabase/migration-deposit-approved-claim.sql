-- Migration: 20260908-deposit-approved-claim
-- Dispatch lease claim for payment approval LINE notifications to prevent concurrent sends while enabling safe retry on failure.

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS deposit_approved_claim_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_reservations_deposit_approved_claim
  ON reservations (deposit_approved_claim_at)
  WHERE deposit_approved_claim_at IS NOT NULL;

INSERT INTO schema_migrations (version, name)
VALUES ('20260908-deposit-approved-claim', 'migration-deposit-approved-claim.sql')
ON CONFLICT (version) DO NOTHING;
