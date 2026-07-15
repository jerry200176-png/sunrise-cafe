-- Refund / cancel-request workflow (policy-driven; no automatic money movement).
-- Safe to apply before Founder finalizes refund table — status starts as requested.

CREATE TABLE IF NOT EXISTS refund_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'rejected', 'processed', 'withdrawn')),
  reason TEXT,
  requested_amount INTEGER,
  currency TEXT NOT NULL DEFAULT 'TWD',
  actor_type TEXT NOT NULL DEFAULT 'guest'
    CHECK (actor_type IN ('guest', 'admin', 'system')),
  actor_ref TEXT,
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refund_requests_reservation_idx
  ON refund_requests (reservation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS refund_requests_status_idx
  ON refund_requests (status, created_at DESC);

ALTER TABLE refund_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny anon refund_requests" ON refund_requests;
-- No anon policies — service_role via Next.js only.

INSERT INTO schema_migrations (version, name)
VALUES ('20260715-refund-requests', 'migration-refund-requests.sql')
ON CONFLICT (version) DO NOTHING;
