-- Migration version tracking for manual Supabase SQL deployments
-- Run once before applying numbered migrations

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE schema_migrations IS 'Records which supabase/migration-*.sql files have been applied';
