-- LINE Pay per-reservation payment ledger.
-- Apply after the application code is deployed; safe to run more than once.

CREATE TABLE IF NOT EXISTS line_pay_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL UNIQUE,
  transaction_id TEXT UNIQUE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'TWD' CHECK (currency = 'TWD'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'cancelled', 'expired', 'failed')),
  payment_url_web TEXT,
  payment_url_app TEXT,
  response_payload JSONB,
  confirmed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_pay_payments_reservation
  ON line_pay_payments(reservation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_line_pay_payments_status
  ON line_pay_payments(status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_line_pay_payments_one_pending
  ON line_pay_payments(reservation_id)
  WHERE status = 'pending';

ALTER TABLE line_pay_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_all_line_pay_payments" ON line_pay_payments;
CREATE POLICY "service_all_line_pay_payments" ON line_pay_payments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO schema_migrations (version, name)
VALUES ('20260813-line-pay-payments', 'migration-line-pay-payments.sql')
ON CONFLICT (version) DO NOTHING;
