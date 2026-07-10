-- Phase 5: demand / revenue optimization prep (aggregates only, no PII)
CREATE TABLE IF NOT EXISTS demand_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  hour SMALLINT NOT NULL DEFAULT -1,
  bookings INTEGER NOT NULL DEFAULT 0,
  booked_hours NUMERIC NOT NULL DEFAULT 0,
  revenue NUMERIC NOT NULL DEFAULT 0,
  cancellations INTEGER NOT NULL DEFAULT 0,
  waitlist_joins INTEGER NOT NULL DEFAULT 0,
  avg_lead_time_hours NUMERIC,
  occupancy_rate NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (snapshot_date, branch_id, room_id, hour)
);

CREATE INDEX IF NOT EXISTS idx_demand_snapshots_date ON demand_snapshots(snapshot_date DESC);

ALTER TABLE demand_snapshots ENABLE ROW LEVEL SECURITY;

INSERT INTO schema_migrations (version, name)
VALUES ('20260710-phase5-demand-snapshots', 'migration-phase5-demand-snapshots.sql')
ON CONFLICT (version) DO NOTHING;
