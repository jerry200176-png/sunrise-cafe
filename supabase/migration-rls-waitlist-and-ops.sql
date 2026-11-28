-- Enable Row Level Security on waitlist (guest PII) and internal backend-only tables.
-- Confirmed all application queries in src/ use SUPABASE_SERVICE_ROLE_KEY (which bypasses RLS);
-- no anon policies are created, blocking direct anon/authenticated PostgREST access.
-- Additive-only SQL (no DROP/REVOKE/ALTER POLICY); execute manually in Supabase SQL Editor (RULEBOOK F1).

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_reminder_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_events ENABLE ROW LEVEL SECURITY;

INSERT INTO schema_migrations (version, name)
VALUES ('20261128-rls-waitlist-and-ops', 'migration-rls-waitlist-and-ops.sql')
ON CONFLICT (version) DO NOTHING;
