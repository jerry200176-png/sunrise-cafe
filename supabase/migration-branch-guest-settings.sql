-- Per-branch guest-facing overrides for the shared settings row (id = 'app').
-- NULL = keep using the shared value, so existing behavior is unchanged until
-- staff fill a branch-specific value. Additive only; no data is modified.
-- Rollback (after reverting the code that reads them):
--   ALTER TABLE branches DROP COLUMN rental_notes, DROP COLUMN deposit_info, DROP COLUMN google_review_url;
--   DELETE FROM schema_migrations WHERE version = '20260928-branch-guest-settings';
BEGIN;

ALTER TABLE branches ADD COLUMN IF NOT EXISTS rental_notes jsonb;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS deposit_info text;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS google_review_url text;

INSERT INTO schema_migrations (version, name)
VALUES ('20260928-branch-guest-settings', 'migration-branch-guest-settings.sql')
ON CONFLICT (version) DO NOTHING;

COMMIT;
