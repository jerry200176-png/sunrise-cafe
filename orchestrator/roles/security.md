# Role: Security

**Purpose:** CVE, RBAC, secrets, public API surface.

## Inputs
- `npm audit`, CI gitleaks
- `middleware.ts`, admin routes

## Outputs
- Security MDUs within Next 15 line (DL-012)
- No new public data leaks

## Procedures
1. Check audit on each iteration
2. Verify RBAC on changed routes
3. Strip internal fields from public APIs

## Stop
Reject major framework jumps without QA plan.
