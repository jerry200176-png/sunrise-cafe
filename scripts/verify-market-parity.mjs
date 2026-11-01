#!/usr/bin/env node
/**
 * Readiness check for migration-market-parity-rounds-3-7.sql. The historical
 * file is intentionally not executed by this runner; an incomplete probe
 * requires independent review.
 */
import { assertRestSchemaProbe, requireSecureSupabaseBase } from "./lib/rest-schema-probe.mjs";

const PROBES = [
  { table: "reservations", column: "guest_confirmed_at" },
  { table: "reservations", column: "deposit_urgent_reminder_sent_at" },
  { table: "waitlist", column: "staff_called_at" },
  { table: "waitlist", column: "staff_alerted_at" },
];

async function main() {
  const base = requireSecureSupabaseBase(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (key.length < 40 || key.startsWith("<")) {
    throw new Error("market-parity schema probe unknown: missing Supabase URL or service key");
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  for (const { table, column } of PROBES) {
    await assertRestSchemaProbe(`${base}/rest/v1/${table}?select=${column}&limit=0`, headers, `${table}.${column}`);
  }
  console.log("OK: market-parity column probes ready");
}

main().catch((error) => {
  console.error(error?.message ?? "market-parity schema probe failed");
  process.exitCode = 1;
});
