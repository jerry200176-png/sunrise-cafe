-- Phase 6: query performance indexes for cron + BI at multi-branch scale
-- Safe to run multiple times (IF NOT EXISTS).

CREATE INDEX IF NOT EXISTS idx_reservations_start_status
  ON reservations (start_time, status)
  WHERE status != 'cancelled';

CREATE INDEX IF NOT EXISTS idx_reservations_deposit_due
  ON reservations (is_deposit_paid, status, start_time)
  WHERE is_deposit_paid = false AND status IN ('pending', 'confirmed');

CREATE INDEX IF NOT EXISTS idx_reservations_phone_line
  ON reservations (phone)
  WHERE line_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_cancelled_at
  ON reservations (cancelled_at)
  WHERE status = 'cancelled' AND cancelled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_events_created
  ON analytics_events (created_at DESC);

INSERT INTO schema_migrations (version, name)
VALUES ('20260710-phase6-scale-indexes', 'migration-phase6-scale-indexes.sql')
ON CONFLICT (version) DO NOTHING;
