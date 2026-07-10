-- Phase 5: reservation metadata for data quality + cancellation analysis
-- Run after prior migrations.

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT;

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

COMMENT ON COLUMN reservations.cancelled_by IS 'guest | admin | system_deposit | system_other';
COMMENT ON COLUMN reservations.cancellation_reason IS 'Optional reason code or short text';

CREATE OR REPLACE FUNCTION reservations_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reservations_updated_at ON reservations;
CREATE TRIGGER reservations_updated_at
  BEFORE UPDATE ON reservations
  FOR EACH ROW
  EXECUTE FUNCTION reservations_set_updated_at();

UPDATE reservations SET updated_at = COALESCE(created_at, now()) WHERE updated_at IS NULL;

INSERT INTO schema_migrations (version, name)
VALUES ('20260710-phase5-reservation-metadata', 'migration-phase5-reservation-metadata.sql')
ON CONFLICT (version) DO NOTHING;
