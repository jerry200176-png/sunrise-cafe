-- P1-2: Prevent double booking via PostgreSQL exclusion constraint
-- Run in Supabase SQL Editor AFTER verifying no overlapping active reservations exist.
--
-- Pre-check (must return 0 rows):
-- SELECT a.id, b.id, a.room_id, a.start_time, a.end_time, b.start_time, b.end_time
-- FROM reservations a
-- JOIN reservations b ON a.room_id = b.room_id AND a.id < b.id
-- WHERE a.status <> 'cancelled' AND b.status <> 'cancelled'
--   AND a.start_time < b.end_time AND a.end_time > b.start_time;

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE reservations
DROP CONSTRAINT IF EXISTS reservations_no_overlap_excl;

ALTER TABLE reservations
ADD CONSTRAINT reservations_no_overlap_excl
EXCLUDE USING gist (
  room_id WITH =,
  tstzrange(start_time, end_time, '[)') WITH &&
)
WHERE (status IS DISTINCT FROM 'cancelled');

COMMENT ON CONSTRAINT reservations_no_overlap_excl ON reservations IS
  'Prevents overlapping active reservations for the same room (P1-2 concurrency protection)';

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version, name)
VALUES ('20260710-reservations-no-overlap', 'migration-reservations-no-overlap.sql')
ON CONFLICT (version) DO NOTHING;
