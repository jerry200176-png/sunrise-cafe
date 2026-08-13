-- LINE Pay confirmation safety and durable group notification queue.
-- Schema-only migration. It does not change existing payment or reservation rows.

ALTER TABLE line_pay_payments
  DROP CONSTRAINT IF EXISTS line_pay_payments_status_check;

ALTER TABLE line_pay_payments
  ADD CONSTRAINT line_pay_payments_status_check
  CHECK (status IN ('pending', 'confirming', 'paid', 'cancelled', 'expired', 'failed'));

ALTER TABLE line_pay_payments
  ADD COLUMN IF NOT EXISTS confirm_attempt_id UUID,
  ADD COLUMN IF NOT EXISTS confirm_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_provider_code TEXT,
  ADD COLUMN IF NOT EXISTS last_provider_message TEXT,
  ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT;

ALTER TABLE line_pay_payments
  DROP CONSTRAINT IF EXISTS line_pay_payments_reconciliation_status_check;

ALTER TABLE line_pay_payments
  ADD CONSTRAINT line_pay_payments_reconciliation_status_check
  CHECK (reconciliation_status IS NULL OR reconciliation_status IN ('in_progress', 'unknown', 'resolved', 'failed'));

CREATE INDEX IF NOT EXISTS idx_line_pay_payments_confirming
  ON line_pay_payments(status, confirm_started_at)
  WHERE status = 'confirming';

CREATE TABLE IF NOT EXISTS line_pay_notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES line_pay_payments(id) ON DELETE CASCADE,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL CHECK (event_type = 'payment_confirmed'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'retrying', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_pay_notification_outbox_due
  ON line_pay_notification_outbox(status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_line_pay_notification_outbox_payment
  ON line_pay_notification_outbox(payment_id);

CREATE TABLE IF NOT EXISTS line_pay_notification_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id UUID NOT NULL REFERENCES line_pay_notification_outbox(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (outbox_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_line_pay_notification_attempts_outbox
  ON line_pay_notification_attempts(outbox_id, created_at DESC);

ALTER TABLE line_pay_notification_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_line_pay_notification_outbox" ON line_pay_notification_outbox;
CREATE POLICY "service_all_line_pay_notification_outbox" ON line_pay_notification_outbox
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE line_pay_notification_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_line_pay_notification_attempts" ON line_pay_notification_attempts;
CREATE POLICY "service_all_line_pay_notification_attempts" ON line_pay_notification_attempts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- This function is the one local commit point for a successful provider payment.
-- Re-running it for the same payment is safe and returns the existing outbox row.
CREATE OR REPLACE FUNCTION finalize_line_pay_payment(
  p_payment_id UUID,
  p_transaction_id TEXT,
  p_response_payload JSONB,
  p_payload JSONB
) RETURNS TABLE(payment_id UUID, reservation_id UUID, outbox_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment line_pay_payments%ROWTYPE;
  v_outbox_id UUID;
BEGIN
  SELECT * INTO v_payment
  FROM line_pay_payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LINE Pay payment not found';
  END IF;

  IF v_payment.status = 'paid' THEN
    SELECT id INTO v_outbox_id
    FROM line_pay_notification_outbox
    WHERE payment_id = v_payment.id
      AND event_key = 'linepay:payment-confirmed:' || v_payment.id::text
    LIMIT 1;

    IF v_outbox_id IS NULL THEN
      INSERT INTO line_pay_notification_outbox (
        payment_id, reservation_id, event_key, event_type, payload
      ) VALUES (
        v_payment.id,
        v_payment.reservation_id,
        'linepay:payment-confirmed:' || v_payment.id::text,
        'payment_confirmed',
        COALESCE(p_payload, '{}'::jsonb)
      )
      RETURNING id INTO v_outbox_id;
    END IF;

    RETURN QUERY SELECT v_payment.id, v_payment.reservation_id, v_outbox_id;
    RETURN;
  END IF;

  IF v_payment.status NOT IN ('pending', 'confirming') THEN
    RAISE EXCEPTION 'LINE Pay payment is not confirmable';
  END IF;

  UPDATE line_pay_payments
  SET status = 'paid',
      transaction_id = p_transaction_id,
      confirmed_at = COALESCE(confirmed_at, now()),
      response_payload = p_response_payload,
      last_provider_code = '0000',
      reconciliation_status = 'resolved',
      last_reconciled_at = now(),
      updated_at = now()
  WHERE id = v_payment.id;

  UPDATE reservations
  SET is_deposit_paid = true,
      deposit_status = 'paid',
      deposit_payment_note = 'LINE Pay paid: ' || p_transaction_id
  WHERE id = v_payment.reservation_id;

  INSERT INTO line_pay_notification_outbox (
    payment_id, reservation_id, event_key, event_type, payload
  ) VALUES (
    v_payment.id,
    v_payment.reservation_id,
    'linepay:payment-confirmed:' || v_payment.id::text,
    'payment_confirmed',
    COALESCE(p_payload, '{}'::jsonb)
  )
  ON CONFLICT (event_key) DO NOTHING
  RETURNING id INTO v_outbox_id;

  IF v_outbox_id IS NULL THEN
    SELECT id INTO v_outbox_id
    FROM line_pay_notification_outbox
    WHERE event_key = 'linepay:payment-confirmed:' || v_payment.id::text
    LIMIT 1;
  END IF;

  RETURN QUERY SELECT v_payment.id, v_payment.reservation_id, v_outbox_id;
END;
$$;

REVOKE ALL ON FUNCTION finalize_line_pay_payment(UUID, TEXT, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finalize_line_pay_payment(UUID, TEXT, JSONB, JSONB) TO service_role;

INSERT INTO schema_migrations (version, name)
VALUES ('20260813-line-pay-safety', 'migration-line-pay-safety.sql')
ON CONFLICT (version) DO NOTHING;
