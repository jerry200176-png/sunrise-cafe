---
id: OBS-YYYY-MM-DD-001
timestamp: YYYY-MM-DDTHH:MM:SS+00:00
ticket: TICKET-NNN
actor: agent:your-agent
trigger:
  - blocked_by_governance
  - test_failure
tags:
  - drift
  - scope
confidence: high
---

## What happened
Describe what the agent attempted and what happened.

## Evidence
- audit log lines: NNN-NNN
- command: exo do TICKET-NNN

## Immediate outcome
What was the result (blocked, failed, etc.)?

## Notes
Pure observation. No interpretation or fix proposed here.
