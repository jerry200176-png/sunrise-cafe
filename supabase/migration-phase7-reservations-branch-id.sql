-- Phase 7: denormalize branch_id on reservations for scale queries
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_branch_start
  ON reservations (branch_id, start_time)
  WHERE status != 'cancelled';

-- Backfill from rooms
UPDATE reservations r
SET branch_id = rm.branch_id
FROM rooms rm
WHERE r.room_id = rm.id AND r.branch_id IS NULL;

INSERT INTO schema_migrations (version, name)
VALUES ('20260710-phase7-reservations-branch-id', 'migration-phase7-reservations-branch-id.sql')
ON CONFLICT (version) DO NOTHING;
