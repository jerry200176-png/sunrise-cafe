-- Phase 6: analytics retention for long-term scale (no PII in analytics_events)
-- Default retention: 730 days (24 months). Invoke via admin/cron maintenance route.

CREATE OR REPLACE FUNCTION purge_analytics_events_older_than(retention_days INT DEFAULT 730)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count BIGINT;
BEGIN
  IF retention_days < 30 THEN
    RAISE EXCEPTION 'retention_days must be at least 30';
  END IF;

  DELETE FROM analytics_events
  WHERE created_at < now() - (retention_days || ' days')::INTERVAL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION purge_analytics_events_older_than IS
  'Deletes analytics_events older than retention_days. Default 730 (24 months).';

INSERT INTO schema_migrations (version, name)
VALUES ('20260710-phase6-analytics-retention', 'migration-phase6-analytics-retention.sql')
ON CONFLICT (version) DO NOTHING;
