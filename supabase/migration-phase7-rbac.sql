-- Phase 7: RBAC — admin users, branch scopes, permission audit
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('owner', 'branch_manager', 'staff', 'finance')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_user_branches (
  user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_user_branches_branch ON admin_user_branches(branch_id);

CREATE TABLE IF NOT EXISTS admin_permission_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_permission_audit_created
  ON admin_permission_audit(created_at DESC);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_user_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_permission_audit ENABLE ROW LEVEL SECURITY;

INSERT INTO schema_migrations (version, name)
VALUES ('20260710-phase7-rbac', 'migration-phase7-rbac.sql')
ON CONFLICT (version) DO NOTHING;
