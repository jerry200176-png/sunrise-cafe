-- Stripe Payment Intents 追蹤表
-- 2026-07-13: P1 Stripe 支付 UI 整合 (#99)

CREATE TABLE IF NOT EXISTS payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_pi_id TEXT UNIQUE NOT NULL,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'twd',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_intents_reservation
  ON payment_intents(reservation_id);

CREATE INDEX IF NOT EXISTS idx_payment_intents_stripe_pi
  ON payment_intents(stripe_pi_id);
