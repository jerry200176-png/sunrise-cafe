-- 付款事件稽核表（漸進式付款審核流程，見 docs/PAYMENT_STATE_MODEL.md）
-- 在 Supabase Dashboard → SQL Editor 執行（可重複執行，IF NOT EXISTS / DROP POLICY IF EXISTS）

CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('line_text', 'line_image', 'admin', 'bank_csv', 'gateway')),
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'approved', 'rejected')),
  raw_payload TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE payment_events IS '付款提交與審核稽核紀錄（append-only）；後端經 service_role 寫入';

CREATE INDEX IF NOT EXISTS idx_payment_events_reservation_id
  ON payment_events(reservation_id);

CREATE INDEX IF NOT EXISTS idx_payment_events_pending_review
  ON payment_events(status, created_at DESC)
  WHERE status = 'pending_review';

-- RLS：不開放 anon / authenticated；與 reservations 相同，僅後端 service_role 存取
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_all_payment_events" ON payment_events;
CREATE POLICY "service_all_payment_events" ON payment_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 未來 Phase：訂金入帳時間與方式（可先不執行，#53 後續）
-- ALTER TABLE reservations ADD COLUMN IF NOT EXISTS deposit_paid_at TIMESTAMPTZ;
-- ALTER TABLE reservations ADD COLUMN IF NOT EXISTS payment_method TEXT;
