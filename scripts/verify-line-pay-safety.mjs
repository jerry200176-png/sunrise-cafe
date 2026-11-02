#!/usr/bin/env node
/**
 * Readiness check for migration-line-pay-payments.sql and
 * migration-line-pay-safety.sql. These historical files are intentionally not
 * executed by this runner; an incomplete probe requires independent review.
 */
import { assertRestSchemaProbe, requireSecureSupabaseBase } from "./lib/rest-schema-probe.mjs";

async function main() {
  const base = requireSecureSupabaseBase(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (key.length < 40 || key.startsWith("<")) {
    throw new Error("LINE Pay schema probe unknown: missing Supabase URL or service key");
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  await Promise.all([
    assertRestSchemaProbe(`${base}/rest/v1/line_pay_payments?select=id,confirm_attempt_id&limit=0`, headers, "line_pay_payments"),
    assertRestSchemaProbe(`${base}/rest/v1/line_pay_notification_outbox?select=id,status&limit=0`, headers, "line_pay_notification_outbox"),
  ]);
  console.log("OK: linepay safety schema probes ready");
}

main().catch((error) => {
  console.error(error?.message ?? "LINE Pay safety schema probe failed");
  process.exitCode = 1;
});
