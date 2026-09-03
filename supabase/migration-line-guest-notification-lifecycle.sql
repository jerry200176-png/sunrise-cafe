-- Extend the automatic guest LINE ledger to one-shot reservation lifecycle events.
-- The unique key remains one delivery per event, reservation, and LINE recipient.

ALTER TABLE line_guest_notification_deliveries
  DROP CONSTRAINT IF EXISTS line_guest_notification_deliveries_notification_type_check;

ALTER TABLE line_guest_notification_deliveries
  ADD CONSTRAINT line_guest_notification_deliveries_notification_type_check
  CHECK (
    notification_type IN (
      'deposit_request',
      'booking_cancelled',
      'booking_rescheduled',
      'attendance_confirmed'
    )
  );

ALTER TABLE line_guest_notification_deliveries
  ADD COLUMN IF NOT EXISTS event_key TEXT NOT NULL DEFAULT 'default';

ALTER TABLE line_guest_notification_deliveries
  DROP CONSTRAINT IF EXISTS line_guest_notification_deliveries_notification_type_reservation_id_recipient_id_key;

ALTER TABLE line_guest_notification_deliveries
  DROP CONSTRAINT IF EXISTS line_guest_notification_deliveries_event_key_key;

ALTER TABLE line_guest_notification_deliveries
  ADD CONSTRAINT line_guest_notification_deliveries_event_key_key
  UNIQUE (notification_type, reservation_id, recipient_id, event_key);

DROP FUNCTION IF EXISTS claim_line_guest_notification_delivery(TEXT, UUID, TEXT);
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
  ON CONFLICT (notification_type, reservation_id, recipient_id, event_key) DO UPDATE
    SET status = 'sending',
        attempt_count = line_guest_notification_deliveries.attempt_count + 1,
        last_error = NULL,
        created_at = now()
    WHERE line_guest_notification_deliveries.status = 'failed'
  RETURNING id;
$$;

REVOKE ALL ON FUNCTION claim_line_guest_notification_delivery(TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_line_guest_notification_delivery(TEXT, UUID, TEXT, TEXT) TO service_role;

INSERT INTO schema_migrations (version, name)
VALUES ('20260903-line-guest-notification-lifecycle', 'migration-line-guest-notification-lifecycle.sql')
ON CONFLICT (version) DO NOTHING;
