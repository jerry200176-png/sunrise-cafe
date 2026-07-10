-- Phase 7: business action loop — connect insights to measured outcomes
CREATE TABLE IF NOT EXISTS business_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL CHECK (action_type IN (
    'campaign', 'promotion', 'engagement', 'ops_recommendation'
  )),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'scheduled', 'running', 'completed', 'cancelled'
  )),
  target_metric TEXT,
  baseline_value NUMERIC,
  result_value NUMERIC,
  revenue_impact NUMERIC,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_actions_branch_status
  ON business_actions(branch_id, status);

ALTER TABLE business_actions ENABLE ROW LEVEL SECURITY;

INSERT INTO schema_migrations (version, name)
VALUES ('20260710-phase7-business-actions', 'migration-phase7-business-actions.sql')
ON CONFLICT (version) DO NOTHING;
