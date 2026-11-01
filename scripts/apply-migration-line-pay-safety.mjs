#!/usr/bin/env node
/** Verify the LINE Pay safety probes without automatically replaying old DDL. */
import { assertRestSchemaProbe } from "./lib/rest-schema-probe.mjs";

async function main() {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!base || key.length < 40 || key.startsWith("<")) {
    throw new Error("LINE Pay schema probe unknown: missing Supabase URL or service key");
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  await Promise.all([
    assertRestSchemaProbe(`${base}/rest/v1/line_pay_payments?select=id,confirm_attempt_id&limit=1`, headers, "line_pay_payments"),
    assertRestSchemaProbe(`${base}/rest/v1/line_pay_notification_outbox?select=id,status&limit=1`, headers, "line_pay_notification_outbox"),
  ]);
  console.log("OK: linepay safety schema probes ready");
}

main().catch((error) => {
  console.error(error?.message ?? "LINE Pay safety schema probe failed");
  process.exitCode = 1;
});
