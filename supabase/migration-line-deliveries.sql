-- One "send this LINE message only once" ledger (deliverOnce).
-- Replaces the per-feature ledgers for guest lifecycle notifications; the
-- reminder and deposit-request ledgers keep their own tables for now.
-- Semantics are unchanged from line_guest_notification_deliveries: a claim in
-- 'sending' or 'sent' state is held (at-most-once), only a 'failed' row can be
-- re-claimed.
-- Additive only: existing tables are untouched. Backfill copies historical
-- guest-notification rows so cut-over cannot replay an old notification.
-- Rollback (after reverting the code):
--   DROP FUNCTION claim_line_delivery(TEXT, UUID, TEXT, TEXT);
--   DROP TABLE line_deliveries;
--   DELETE FROM schema_migrations WHERE version = '20261008-line-deliveries';
BEGIN;

CREATE TABLE IF NOT EXISTS line_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL,
  event_key TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  UNIQUE (kind, reservation_id, recipient_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_line_deliveries_status
  ON line_deliveries (kind, status, created_at DESC);

ALTER TABLE line_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_all_line_deliveries" ON line_deliveries;
CREATE POLICY "service_all_line_deliveries" ON line_deliveries
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION claim_line_delivery(
  p_kind TEXT,
  p_reservation_id UUID,
  p_recipient_id TEXT,
  p_event_key TEXT DEFAULT 'default'
)
RETURNS TABLE (delivery_id UUID)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO line_deliveries (kind, reservation_id, recipient_id, event_key, status)
  SELECT p_kind, r.id, p_recipient_id, p_event_key, 'sending'
  FROM reservations r
  WHERE r.id = p_reservation_id
  ON CONFLICT (kind, reservation_id, recipient_id, event_key) DO UPDATE
    SET status = 'sending',
        attempt_count = line_deliveries.attempt_count + 1,
        last_error = NULL,
        created_at = now()
    WHERE line_deliveries.status = 'failed'
  RETURNING id;
$$;

REVOKE ALL ON FUNCTION claim_line_delivery(TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_line_delivery(TEXT, UUID, TEXT, TEXT) TO service_role;

-- Carry over what was already delivered or claimed (skipped on a fresh database
-- where the legacy ledger does not exist yet).
DO $$
BEGIN
  IF to_regclass('public.line_guest_notification_deliveries') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'line_guest_notification_deliveries'
          AND column_name = 'event_key'
     ) THEN
    INSERT INTO line_deliveries
      (kind, reservation_id, recipient_id, event_key, status, attempt_count, last_error, created_at, sent_at)
    SELECT notification_type, reservation_id, recipient_id, event_key, status, attempt_count, last_error, created_at, sent_at
    FROM line_guest_notification_deliveries
    WHERE notification_type IN ('booking_cancelled', 'booking_rescheduled', 'attendance_confirmed')
    ON CONFLICT (kind, reservation_id, recipient_id, event_key) DO NOTHING;
  END IF;
END
$$;

INSERT INTO schema_migrations (version, name)
VALUES ('20261008-line-deliveries', 'migration-line-deliveries.sql')
ON CONFLICT (version) DO NOTHING;

COMMIT;
