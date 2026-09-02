-- LINE reminder delivery ledger.
-- Claims are at-most-once across overlapping cron invocations. A failed LINE
-- request may be retried; an accepted request remains claimed after a crash so
-- a cron retry cannot create a second push with unknown delivery status.

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS d1_guest_reminder_sent_at TIMESTAMPTZ;

-- Existing is_notified rows were sent by the old D-1 flow, which sent the
-- guest reminder immediately after the group digest. Seed the compatibility
-- marker so the first ledger rollout cannot replay historical guest reminders.
UPDATE reservations
SET d1_guest_reminder_sent_at = COALESCE(d1_guest_reminder_sent_at, now())
WHERE is_notified = TRUE;

CREATE TABLE IF NOT EXISTS line_reminder_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_type TEXT NOT NULL,
  reminder_date DATE NOT NULL,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('group', 'guest')),
  recipient_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  message_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  UNIQUE (reminder_type, reminder_date, reservation_id, recipient_type, recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_line_reminder_deliveries_date
  ON line_reminder_deliveries (reminder_date, reminder_type, status);

CREATE OR REPLACE FUNCTION claim_line_reminder_delivery(
  p_reminder_type TEXT,
  p_reminder_date DATE,
  p_reservation_id UUID,
  p_recipient_type TEXT,
  p_recipient_id TEXT
)
RETURNS TABLE (delivery_id UUID)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO line_reminder_deliveries (
    reminder_type,
    reminder_date,
    reservation_id,
    recipient_type,
    recipient_id,
    status
  )
  SELECT
    p_reminder_type,
    p_reminder_date,
    r.id,
    p_recipient_type,
    p_recipient_id,
    'sending'
  FROM reservations r
  WHERE r.id = p_reservation_id
    AND r.status IN ('pending', 'confirmed')
    AND (
      p_reminder_type NOT IN (
        'deposit_initial',
        'deposit_urgent',
        'deposit_release_guest',
        'deposit_release_group'
      )
      OR r.is_deposit_paid = FALSE
    )
    AND (
      p_reminder_type <> 'd1_group'
      OR r.is_notified = FALSE
    )
    AND (
      p_reminder_type <> 'd1_guest'
      OR r.d1_guest_reminder_sent_at IS NULL
    )
    AND (
      p_reminder_type <> 'd7_guest'
      OR r.is_reminded_7d = FALSE
    )
    AND (
      p_reminder_type <> 'deposit_initial'
      OR r.deposit_reminder_sent_at IS NULL
    )
    AND (
      p_reminder_type <> 'deposit_urgent'
      OR r.deposit_urgent_reminder_sent_at IS NULL
    )
  ON CONFLICT (
    reminder_type,
    reminder_date,
    reservation_id,
    recipient_type,
    recipient_id
  ) DO UPDATE
    SET status = 'sending',
        attempt_count = line_reminder_deliveries.attempt_count + 1,
        last_error = NULL,
        created_at = now()
    WHERE line_reminder_deliveries.status = 'failed'
  RETURNING id;
$$;

REVOKE ALL ON FUNCTION claim_line_reminder_delivery(TEXT, DATE, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_line_reminder_delivery(TEXT, DATE, UUID, TEXT, TEXT) TO service_role;

INSERT INTO schema_migrations (version, name)
VALUES ('20260902-line-reminder-deliveries', 'migration-line-reminder-deliveries.sql')
ON CONFLICT (version) DO NOTHING;
