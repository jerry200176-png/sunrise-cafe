# Portfolio agent governance overlay

This file is committed because a cloud or mobile agent may not have access to
Ubuntu's `/home/jerry`. The canonical, detailed policy is maintained in
`jerry200176-png/portfolio-ops` under `governance/`; this file is the portable
minimum that travels with each governed repository.

## Required behavior

- Treat Cursor, Codex, Claude Code, and Cubelv as untrusted writers.
- Before writing, identify the repository, branch/worktree, task scope, risk,
  and verification plan. Never work directly on the default branch.
- Read this repository's committed instructions and ExoProtocol's `.exo/`
  constitution/lock when present. Do not edit governance files to make a task
  pass or to bypass a lock, ticket, session, CI check, or review.
- Every change goes through a pull request and requires an independent human
  approval. Branch prefixes and self-authored provenance files never grant a
  bypass.
- Agents may prepare code and Draft PRs. Merge, deploy, production-data
  mutation, credential rotation/revocation, issue closure, and history rewrite
  require Founder approval.
- Prefer mature open-source tools for generic lint, security, workflow, and
  policy checks; keep company-specific risk, provenance, evidence, and release
  boundaries in committed policy and CI.

If this overlay conflicts with a stricter product or safety rule, the stricter
rule wins. If the overlay or required governance context is unavailable, stop
and report the missing context instead of inventing a replacement.
