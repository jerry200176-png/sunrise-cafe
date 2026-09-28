-- Per-weekday opening hours for a branch (e.g. 同德店: 週二至週五 14-18, 週末 10-18, 週一公休).
-- Shape: {"sun":{"open":"10:00","close":"18:00"},"mon":null,...}; a null day is closed,
-- a missing day uses open_time/close_time. NULL column = today's behavior for every day.
-- Additive only; no data is modified.
-- Rollback (after reverting the code that reads it):
--   ALTER TABLE branches DROP COLUMN weekly_hours;
--   DELETE FROM schema_migrations WHERE version = '20260928-branch-weekly-hours';
BEGIN;

ALTER TABLE branches ADD COLUMN IF NOT EXISTS weekly_hours jsonb;

INSERT INTO schema_migrations (version, name)
VALUES ('20260928-branch-weekly-hours', 'migration-branch-weekly-hours.sql')
ON CONFLICT (version) DO NOTHING;

COMMIT;
