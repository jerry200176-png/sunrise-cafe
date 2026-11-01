#!/usr/bin/env node
/** migration-ops-events.sql has no complete verified readiness contract here. */
// Do not probe or write: an HTTP response alone cannot establish the target,
// migration ledger, schema, indexes or effective permissions.
console.error("ops_events migration readiness unverified; no migration was run");
process.exitCode = 1;
