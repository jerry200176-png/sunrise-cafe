-- OPS-004b: Persist guest/admin funnel events for North Star KPI aggregation.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS ops_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  domain TEXT NOT NULL,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ops_events_action_ts ON ops_events (action, ts DESC);
CREATE INDEX IF NOT EXISTS idx_ops_events_ts ON ops_events (ts DESC);

INSERT INTO schema_migrations (version, applied_at)
VALUES ('20260713-ops-events', now())
ON CONFLICT (version) DO NOTHING;
