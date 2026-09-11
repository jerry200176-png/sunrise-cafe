-- Bind automatic deposit-request retries to the original delivery UUID, which
-- is also sent as X-Line-Retry-Key. LINE only guarantees retry-key idempotency
-- for 24 hours, so an old failed request must not be automatically re-claimed.
-- Lifecycle notification retry behavior remains unchanged.

CREATE OR REPLACE FUNCTION claim_line_guest_notification_delivery(
  p_notification_type TEXT,
  p_reservation_id UUID,
  p_recipient_id TEXT,
  p_event_key TEXT DEFAULT 'default'
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
    event_key,
    status
  )
  SELECT
    p_notification_type,
    r.id,
    p_recipient_id,
    p_event_key,
    'sending'
  FROM reservations r
  WHERE r.id = p_reservation_id
    AND r.line_user_id = p_recipient_id
    AND (
      p_notification_type <> 'deposit_request'
      OR r.is_deposit_paid = FALSE
    )
  ON CONFLICT (notification_type, reservation_id, recipient_id, event_key) DO UPDATE
    SET status = 'sending',
        attempt_count = line_guest_notification_deliveries.attempt_count + 1,
        last_error = NULL
    WHERE line_guest_notification_deliveries.status = 'failed'
      AND (
        p_notification_type <> 'deposit_request'
        OR line_guest_notification_deliveries.created_at > now() - INTERVAL '24 hours'
      )
  RETURNING id;
$$;

REVOKE ALL ON FUNCTION claim_line_guest_notification_delivery(TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_line_guest_notification_delivery(TEXT, UUID, TEXT, TEXT) TO service_role;

INSERT INTO schema_migrations (version, name)
VALUES (
  '20260911-line-guest-deposit-request-retry-key',
  'migration-line-guest-notification-deposit-request-retry-key.sql'
)
ON CONFLICT (version) DO NOTHING;
