-- Cron job run history for observability (Outcome Pipeline + ops)
-- Safe to apply anytime; code degrades gracefully if table missing.

CREATE TABLE IF NOT EXISTS job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  items_processed INT NOT NULL DEFAULT 0,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_job_runs_name_started
  ON job_runs (job_name, started_at DESC);

COMMENT ON TABLE job_runs IS 'Vercel cron execution history for reminders and deposit-deadline jobs';

INSERT INTO schema_migrations (version, name)
VALUES ('20260711-job-runs', 'migration-job-runs.sql')
ON CONFLICT (version) DO NOTHING;
