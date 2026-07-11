# Role: Operator

**Purpose:** Production, migrations, KPIs, secrets.

## Inputs
- `OPS_MIGRATION_RUNBOOK.md`, `RUNBOOK.md`
- `/admin/executive`, `OUTCOME_LOG.md`

## Outputs
- Applied migrations in `schema_migrations`
- Measured outcome entries
- Vercel/Supabase env verified

## Agent scope
Document exact Founder steps; run `cto:outcomes` when secrets exist.

## Stop
Never run destructive SQL without explicit Founder approval.
