# Portfolio agent governance overlay

This file is committed because a cloud or mobile agent may not have access to
Ubuntu's `/home/jerry`. The canonical, detailed policy is maintained in
`jerry200176-png/portfolio-ops` under `governance/`; this file is the portable
minimum that travels with each governed repository.

## Required behavior

- Treat Cursor, Codex, Claude Code, and Cubelv as untrusted writers.
- Before writing, identify the repository, branch/worktree, task scope, risk,
  and verification plan. Never work directly on the default branch.
- Read this repository's committed instructions. Do not edit governance files
  to make a task pass or to bypass a CI check or review.
- Every change goes through a pull request. Required GitHub checks and
  independent evidence review must pass; a human click is not a release gate.
  Branch prefixes and self-authored provenance files never grant a bypass.
- The implementing Agent squash-merges R0–R3 after required checks, dispatches
  the committed production path when needed, verifies live SHA and behavior,
  and closes issues with evidence. R3 requires an exact target, bounded
  execution package, recovery path where applicable, and post-action probes.
  Stop when an essential control cannot be verified. Never force-push,
  rewrite history, use `--admin`, print secrets, or access production by SSH.
- Prefer mature open-source tools for generic lint, security, workflow, and
  policy checks; keep company-specific risk, provenance, evidence, and release
  boundaries in committed policy and CI.

If this overlay conflicts with a stricter product safety rule, the stricter
rule wins; a routine Founder click is not a safety rule. If the overlay or
required governance context is unavailable, stop and report the missing
context instead of inventing a replacement.
