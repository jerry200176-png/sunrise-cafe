# Contributing

## Before starting

1. Read `AGENTS.md` and `docs/governance/OVERLAY.md`.
2. Open or select a GitHub issue with priority, owner area, acceptance
   evidence, and rollback expectations.
3. Run `agent-start sunrise <task-id>` and work only in the generated
   worktree.

## Pull requests

Keep each pull request narrow and link it to an issue. Include:

- customer or operational outcome;
- risk and rollback plan;
- tests run and their results;
- production verification required after merge;
- documentation updated when behavior or operations change.

Before pushing:

```bash
npm run agent-preflight
npm test
npm run lint
npm run build
```

Do not commit credentials, production data, payment screenshots, local
environment files, or generated test artifacts. Do not bypass protected
`main` or deploy production from an unreviewed branch.

## Security

Follow `SECURITY.md`. Do not disclose vulnerabilities or private customer
information in a public issue.
