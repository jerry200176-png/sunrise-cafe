-- Stripe 支付整合 (#99)：payment_intents 表 + reservations 擴充
-- 在 Supabase Dashboard → SQL Editor 執行（可重複執行，IF NOT EXISTS / ADD COLUMN IF NOT EXISTS）

CREATE TABLE IF NOT EXISTS payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_pi_id TEXT UNIQUE NOT NULL,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'twd',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE payment_intents IS 'Stripe PaymentIntent 紀錄（#99 Stripe 整合）';

CREATE INDEX IF NOT EXISTS idx_payment_intents_stripe_pi_id
  ON payment_intents(stripe_pi_id);

CREATE INDEX IF NOT EXISTS idx_payment_intents_reservation_id
  ON payment_intents(reservation_id);

-- reservations 新增欄位：deposit_status + payment_intent_id
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS deposit_status TEXT DEFAULT 'pending';
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS payment_intent_id TEXT;

COMMENT ON COLUMN reservations.deposit_status IS '訂金狀態：pending | paid | refunded | cancelled';
COMMENT ON COLUMN reservations.payment_intent_id IS '關聯 Stripe PaymentIntent ID';

-- RLS：僅 service_role 可存取 payment_intents
ALTER TABLE payment_intents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_all_payment_intents" ON payment_intents;
CREATE POLICY "service_all_payment_intents" ON payment_intents
  FOR ALL TO service_role USING (true) WITH CHECK (true);
