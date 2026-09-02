-- Durable idempotency ledger for automatic guest LINE notifications.
-- A sending claim remains held after an unknown process crash. This favors
-- at-most-once billing over an automatic duplicate; staff can explicitly
-- resend through the existing force path when needed.

CREATE TABLE IF NOT EXISTS line_guest_notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type TEXT NOT NULL CHECK (notification_type IN ('deposit_request')),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  UNIQUE (notification_type, reservation_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_line_guest_notification_deliveries_status
  ON line_guest_notification_deliveries (notification_type, status, created_at DESC);

ALTER TABLE line_guest_notification_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_all_line_guest_notification_deliveries"
  ON line_guest_notification_deliveries;
CREATE POLICY "service_all_line_guest_notification_deliveries"
  ON line_guest_notification_deliveries
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION claim_line_guest_notification_delivery(
  p_notification_type TEXT,
  p_reservation_id UUID,
  p_recipient_id TEXT
)
RETURNS TABLE (delivery_id UUID)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO line_guest_notification_deliveries (
    notification_type,
    reservation_id,
    recipient_id,
    status
  )
  SELECT
    p_notification_type,
    r.id,
    p_recipient_id,
    'sending'
  FROM reservations r
  WHERE r.id = p_reservation_id
    AND r.line_user_id = p_recipient_id
    AND r.is_deposit_paid = FALSE
  ON CONFLICT (notification_type, reservation_id, recipient_id) DO UPDATE
    SET status = 'sending',
        attempt_count = line_guest_notification_deliveries.attempt_count + 1,
        last_error = NULL,
        created_at = now()
    WHERE line_guest_notification_deliveries.status = 'failed'
  RETURNING id;
$$;

REVOKE ALL ON FUNCTION claim_line_guest_notification_delivery(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_line_guest_notification_delivery(TEXT, UUID, TEXT) TO service_role;

INSERT INTO schema_migrations (version, name)
VALUES ('20260903-line-guest-notification-deliveries', 'migration-line-guest-notification-deliveries.sql')
ON CONFLICT (version) DO NOTHING;
