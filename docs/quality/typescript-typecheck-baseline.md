# TypeScript typecheck baseline

## Baseline

- Repository: `jerry200176-png/sunrise-cafe`
- Captured at SHA: `b86235795904dd0cb5231da993d3048ce453aa9c`
- Command: `npm run typecheck`
- Result: 13 existing diagnostics
- Detailed machine-readable baseline: `docs/quality/typescript-baseline.txt`

The baseline is intentionally committed instead of hiding errors with `ts-ignore`, a relaxed compiler configuration, or `|| true`.

## Classification

- E2E test narrowing: one diagnostic in `e2e/admin-today.spec.ts`.
- Test environment isolation: seven diagnostics caused by direct writes to readonly `process.env.NODE_ENV`.
- Test fixture/model drift: three diagnostics in `gmail-ops`, `north-star-metrics`, and `outcome-metrics` fixtures.

## CI contract

- `npm run typecheck` runs on every CI execution as an advisory diagnostic while the baseline is burned down.
- `npm run typecheck:baseline` is the regression gate. It fails if a change introduces any diagnostic not present in the committed baseline.
- Resolved diagnostics are reported so the baseline can be reduced deliberately in a follow-up PR.
- The baseline is not a permanent exemption: every entry needs a follow-up fix or an explicit issue reference.
