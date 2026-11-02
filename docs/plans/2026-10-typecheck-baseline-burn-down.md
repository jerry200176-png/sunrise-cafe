# Typecheck baseline burn-down

## Problem and root cause

`tsc --noEmit` reported seven remaining diagnostics on `origin/main` at `29e2f64544f8f7ec00153b26a791dc52671a4982`. These came from test fixtures and test setup: direct assignment to readonly `process.env.NODE_ENV`, a callback assigned inside a Promise executor that TypeScript could not narrow, a JavaScript options parameter inferred too narrowly from its `null` default, and fixtures that no longer matched the application types for cron job status and summary fields.

Five whys: the typecheck job was advisory because it failed; it failed because test files did not satisfy current TypeScript types; those tests used ad hoc environment writes and stale/incomplete fixture values; the baseline was retained while legacy errors were paid down; these seven errors remained after later main changes. The root cause was test code drifting from the typed runtime contracts, not a compiler configuration or product behavior defect. The fix corrects those test contracts and makes the test environment API explicit.

## Design

- Use Vitest `vi.stubEnv` / `vi.unstubAllEnvs` for the cron auth test's `NODE_ENV` cases; remove the unused `NODE_ENV` restore from the rate limit test.
- Give `buildRecommendations` an explicit nullable boolean option type, preserving its existing runtime default and behavior.
- Correct fixture literals and required fields to match `JobRunStatus`, `JobRunSummary`, and `OutcomeSnapshot`.
- Give the Playwright route test's deferred resolver a definite callback type so its existing resolution and assertions remain intact.
- Keep `docs/quality/typescript-baseline.txt` and `typecheck:baseline` unchanged as regression evidence. With `tsc --noEmit` clean, remove CI's `continue-on-error` so the typecheck step blocks the CI job.
- Do not change assertions, `tsconfig`, compiler flags, or allowlists.

## 參考做法

- 競品／大公司怎麼做：GitHub rulesets support required status checks that must pass before a protected branch update ([GitHub documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)); apply that pattern by making the clean typecheck step blocking.
- 開源參考（含授權）：Vitest ([API](https://vitest.dev/api/vi), [MIT license](https://github.com/vitest-dev/vitest/blob/main/LICENSE.md)) — use its environment stubbing and restoration APIs for tests; re-implement no library code.
- 根因 vs 症狀：the symptom was seven `tsc` diagnostics; the root cause was stale fixture typing and untyped environment setup. Correcting those contracts clears the compiler without suppressions or weaker checks.
- Deliberately skipped competitor UX research because this issue concerns an internal CI quality gate, not a customer-facing workflow.

## Verification

- `npm run typecheck`
- `npm run typecheck:baseline`
- Targeted Vitest tests for cron auth, Gmail ops, North Star metrics, outcome metrics, and rate limiting
- Targeted Playwright coverage for `e2e/admin-today.spec.ts` is deferred because its configured web server requires `.next` production output; this task explicitly excludes a full build.
