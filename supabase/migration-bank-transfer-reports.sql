-- In-app bank-transfer reporting on top of the existing payment_events audit layer.
-- Safe rollout: apply this migration before enabling the customer CTA.

ALTER TABLE payment_events
  DROP CONSTRAINT IF EXISTS payment_events_source_check;

ALTER TABLE payment_events
  ADD CONSTRAINT payment_events_source_check
  CHECK (source IN ('line_text', 'line_image', 'admin', 'bank_csv', 'gateway', 'bank_transfer'));

ALTER TABLE payment_events
  ADD COLUMN IF NOT EXISTS reported_account_last_five TEXT,
  ADD COLUMN IF NOT EXISTS reported_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS reported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

ALTER TABLE payment_events
  DROP CONSTRAINT IF EXISTS payment_events_reported_last_five_check;

ALTER TABLE payment_events
  ADD CONSTRAINT payment_events_reported_last_five_check
  CHECK (reported_account_last_five IS NULL OR reported_account_last_five ~ '^\d{5}$');

ALTER TABLE payment_events
  DROP CONSTRAINT IF EXISTS payment_events_reported_amount_check;

ALTER TABLE payment_events
  ADD CONSTRAINT payment_events_reported_amount_check
  CHECK (reported_amount IS NULL OR reported_amount > 0);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_events_one_pending_bank_transfer
  ON payment_events (reservation_id)
  WHERE source = 'bank_transfer' AND status = 'pending_review';

CREATE INDEX IF NOT EXISTS idx_payment_events_bank_transfer_queue
  ON payment_events (status, reported_at ASC)
  WHERE source = 'bank_transfer';

-- Customer submission is authenticated by the signed guest lookup token in the API.
-- The reservation row lock and partial unique index make retries/concurrent submits one event.
CREATE OR REPLACE FUNCTION record_bank_transfer_report(
  p_reservation_id UUID,
  p_reported_account_last_five TEXT,
  p_reported_amount NUMERIC
)
RETURNS TABLE (payment_event_id UUID, outcome TEXT, reservation_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation reservations%ROWTYPE;
  v_event_id UUID;
BEGIN
  SELECT * INTO v_reservation
  FROM reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_reservation.is_deposit_paid THEN
    RETURN QUERY SELECT NULL::UUID, 'already_paid', v_reservation.status;
    RETURN;
  END IF;

  IF COALESCE(v_reservation.total_price, 0) <= 0
     OR v_reservation.status NOT IN ('pending', 'confirmed')
     OR v_reservation.end_time <= now() THEN
    RETURN QUERY SELECT NULL::UUID, 'not_reportable', v_reservation.status;
    RETURN;
  END IF;

  IF p_reported_account_last_five IS NULL
     OR p_reported_account_last_five !~ '^\d{5}$'
     OR p_reported_amount IS NULL
     OR p_reported_amount <= 0 THEN
    RETURN QUERY SELECT NULL::UUID, 'invalid_report', v_reservation.status;
    RETURN;
  END IF;

  SELECT id INTO v_event_id
  FROM payment_events
  WHERE reservation_id = p_reservation_id
    AND source = 'bank_transfer'
    AND status = 'pending_review'
  FOR UPDATE;

  IF FOUND THEN
    RETURN QUERY SELECT v_event_id, 'duplicate', v_reservation.status;
    RETURN;
  END IF;

  INSERT INTO payment_events (
    reservation_id,
    source,
    status,
    raw_payload,
    reported_account_last_five,
    reported_amount,
    reported_at,
    created_by,
    updated_at
  )
  VALUES (
    p_reservation_id,
    'bank_transfer',
    'pending_review',
    'customer_portal_transfer_report',
    p_reported_account_last_five,
    p_reported_amount,
    now(),
    'customer_portal',
    now()
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id
    FROM payment_events
    WHERE reservation_id = p_reservation_id
      AND source = 'bank_transfer'
      AND status = 'pending_review'
    FOR UPDATE;
    RETURN QUERY SELECT v_event_id, 'duplicate', v_reservation.status;
    RETURN;
  END IF;

  INSERT INTO ops_events (domain, action, detail)
  VALUES (
    'payment',
    'payment.bank_transfer_reported',
    jsonb_build_object(
      'reservation_id', p_reservation_id,
      'payment_event_id', v_event_id,
      'source', 'customer_portal',
      'reported_account_last_five', p_reported_account_last_five,
      'reported_amount', p_reported_amount,
      'reported_at', now()
    )
  );

  RETURN QUERY SELECT v_event_id, 'submitted', v_reservation.status;
END;
$$;

REVOKE ALL ON FUNCTION record_bank_transfer_report(UUID, TEXT, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_bank_transfer_report(UUID, TEXT, NUMERIC) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION record_bank_transfer_report(UUID, TEXT, NUMERIC) TO service_role;

-- Only this operator action may turn a bank-transfer report into paid.
-- It locks both rows, validates the server-side expected deposit, and writes the audit event
-- before returning. Notification is deliberately dispatched by the API after this commit.
CREATE OR REPLACE FUNCTION confirm_bank_transfer_payment(
  p_event_id UUID,
  p_actor TEXT,
  p_review_note TEXT DEFAULT NULL
)
RETURNS TABLE (payment_event_id UUID, reservation_id UUID, outcome TEXT, reservation_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event payment_events%ROWTYPE;
  v_reservation reservations%ROWTYPE;
  v_expected NUMERIC;
  v_note TEXT;
BEGIN
  SELECT * INTO v_event
  FROM payment_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_event.source <> 'bank_transfer' THEN
    RAISE EXCEPTION '此付款事件不是銀行轉帳回報';
  END IF;

  IF v_event.status = 'approved' THEN
    SELECT * INTO v_reservation FROM reservations WHERE id = v_event.reservation_id;
    RETURN QUERY SELECT v_event.id, v_event.reservation_id, 'already_processed', v_reservation.status;
    RETURN;
  END IF;

  IF v_event.status <> 'pending_review' THEN
    RAISE EXCEPTION '此匯款回報已不在待核對狀態';
  END IF;

  SELECT * INTO v_reservation
  FROM reservations
  WHERE id = v_event.reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到訂位';
  END IF;

  IF v_reservation.is_deposit_paid THEN
    RAISE EXCEPTION '此訂位訂金已確認，請保留此回報作異常紀錄';
  END IF;

  IF v_reservation.status NOT IN ('pending', 'confirmed')
     OR v_reservation.end_time <= now() THEN
    RAISE EXCEPTION '訂位已取消、完成或過期，無法確認匯款';
  END IF;

  v_expected := ceil(COALESCE(v_reservation.total_price, 0) * 0.5);
  IF v_expected <= 0
     OR v_event.reported_amount IS NULL
     OR v_event.reported_amount <> v_expected
     OR v_event.reported_account_last_five IS NULL
     OR v_event.reported_account_last_five !~ '^\d{5}$' THEN
    RAISE EXCEPTION '匯款回報資料與應收訂金不符，請依異常流程核對';
  END IF;

  v_note := COALESCE(
    NULLIF(trim(p_review_note), ''),
    format('銀行轉帳人工核對：末五碼 %s，金額 NT$ %s', v_event.reported_account_last_five, v_event.reported_amount)
  );

  UPDATE reservations
  SET is_deposit_paid = TRUE,
      status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END,
      deposit_payment_note = v_note
  WHERE id = v_reservation.id;

  UPDATE payment_events
  SET status = 'approved',
      reviewed_at = now(),
      review_note = NULLIF(trim(p_review_note), ''),
      reviewed_by = p_actor,
      updated_at = now(),
      updated_by = p_actor
  WHERE id = v_event.id;

  INSERT INTO ops_events (domain, action, detail)
  VALUES (
    'payment',
    'payment.bank_transfer_confirmed',
    jsonb_build_object(
      'reservation_id', v_reservation.id,
      'payment_event_id', v_event.id,
      'actor', p_actor,
      'reported_amount', v_event.reported_amount,
      'reported_account_last_five', v_event.reported_account_last_five,
      'before_reservation_status', v_reservation.status,
      'after_reservation_status', CASE WHEN v_reservation.status = 'pending' THEN 'confirmed' ELSE v_reservation.status END,
      'confirmed_at', now()
    )
  );

  RETURN QUERY SELECT v_event.id, v_reservation.id, 'confirmed',
    CASE WHEN v_reservation.status = 'pending' THEN 'confirmed' ELSE v_reservation.status END;
END;
$$;

REVOKE ALL ON FUNCTION confirm_bank_transfer_payment(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_bank_transfer_payment(UUID, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_bank_transfer_payment(UUID, TEXT, TEXT) TO service_role;

INSERT INTO schema_migrations (version, name)
VALUES ('20260914-bank-transfer-reports', 'migration-bank-transfer-reports.sql')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';
