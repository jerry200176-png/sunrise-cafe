-- Phase 5: lightweight growth experiment registry
CREATE TABLE IF NOT EXISTS experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  target_audience TEXT NOT NULL DEFAULT 'all',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'running', 'paused', 'completed')),
  variants JSONB NOT NULL DEFAULT '["control","treatment"]'::jsonb,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status);

ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;

INSERT INTO schema_migrations (version, name)
VALUES ('20260710-phase5-experiments', 'migration-phase5-experiments.sql')
ON CONFLICT (version) DO NOTHING;
