#!/usr/bin/env node
/** Verify migration-ops-events.sql through read-only REST; never apply DDL here. */
import { probeOpsEvents } from "../src/lib/ops-events-readiness.mjs";

async function main() {
  const ready = await probeOpsEvents({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!ready) throw new Error("ops_events REST readiness unknown or missing; reviewed migration required");
  console.log("OK: ops_events id is REST-visible; migration was not run");
}

main().catch(() => {
  console.error("ops_events REST readiness unknown or missing; no migration was run");
  process.exitCode = 1;
});
