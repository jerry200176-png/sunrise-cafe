-- Phase 3: First-party analytics events (no PII)
-- Run in Supabase SQL Editor after migration-schema-versions.sql

CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  session_id TEXT,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_name_created
  ON analytics_events (event_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_events_branch_created
  ON analytics_events (branch_id, created_at DESC)
  WHERE branch_id IS NOT NULL;

COMMENT ON TABLE analytics_events IS 'Privacy-first product analytics. No PII — see docs/ANALYTICS.md';

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Service role only (API uses SUPABASE_SERVICE_ROLE_KEY)
CREATE POLICY analytics_events_service_role ON analytics_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO schema_migrations (version, name)
VALUES ('20260710-analytics-events', 'migration-analytics-events.sql')
ON CONFLICT (version) DO NOTHING;
