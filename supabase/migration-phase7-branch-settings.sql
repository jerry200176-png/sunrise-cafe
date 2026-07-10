-- Phase 7: per-branch operational settings (50+ branch readiness)
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS closed_dates JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS operational_config JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN branches.closed_dates IS 'Branch-specific closed dates ["YYYY-MM-DD", ...]';
COMMENT ON COLUMN branches.operational_config IS 'Ops toggles: deposit_reminder_enabled, morning_summary_enabled, etc.';

-- Copy global closed_dates from settings to branches that have empty array (one-time seed)
DO $$
DECLARE
  global_dates JSONB;
BEGIN
  SELECT COALESCE(closed_dates, '[]'::jsonb) INTO global_dates
  FROM settings WHERE id = 'app' LIMIT 1;

  IF global_dates IS NOT NULL AND jsonb_array_length(global_dates) > 0 THEN
    UPDATE branches
    SET closed_dates = global_dates
    WHERE closed_dates = '[]'::jsonb OR closed_dates IS NULL;
  END IF;
END $$;

INSERT INTO schema_migrations (version, name)
VALUES ('20260710-phase7-branch-settings', 'migration-phase7-branch-settings.sql')
ON CONFLICT (version) DO NOTHING;
