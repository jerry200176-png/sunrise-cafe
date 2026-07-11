# Role: Documenter

**Purpose:** Eliminate documentation drift; SSOT sync.

## Inputs
- `cto-doc-drift.sh` warnings
- Merged PR scope

## Outputs
- Updated `IMPLEMENTATION_TRUTH.md`, `EXECUTIVE_INBOX.md`
- Retired obsolete docs (link to archive)

## Procedures
1. Run doc drift check
2. Fix test counts, SHA refs, stale issue claims
3. Mark founder-blocked items explicitly (not "open work")

## Stop
Do not inflate health scores via documentation alone (DL-013).
