#!/usr/bin/env node
/**
 * scripts/reconcile-payment-notification.mjs
 *
 * Minimal operator tool to safely resolve >24h ambiguous payment approval notifications.
 *
 * Usage:
 *   node scripts/reconcile-payment-notification.mjs <reservation_id> --mark-sent
 *   node scripts/reconcile-payment-notification.mjs <reservation_id> --safe-retry
 *   node scripts/reconcile-payment-notification.mjs <reservation_id> --dry-run
 *
 * Options:
 *   --mark-sent   Verify reservation is reconciliation-required, mark notified_at resolved without sending LINE
 *   --safe-retry  Verify reconciliation-required, invoke canonical notification path with evidenceNoProviderAttempt=true
 *   --actor       Operator name or identifier for ops_events audit (default: operator_cli)
 *   --dry-run     Inspect reservation state and check if reconciliation is required without modifying DB
 *   -h, --help    Show this help message
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Load local environment files if present
function loadEnvFile(file) {
  const fullPath = join(ROOT, file);
  if (!existsSync(fullPath)) return;
  const content = readFileSync(fullPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) {
      process.env[k] = v;
    }
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");
loadEnvFile(".env.vercel.prod");

function printHelp() {
  console.log(`
Usage:
  node scripts/reconcile-payment-notification.mjs <reservation_id> [options]

Actions (pick exactly one):
  --mark-sent   Verify reservation is reconciliation-required, mark notified_at resolved without sending LINE
  --safe-retry  Verify reconciliation-required, dispatch with fresh retry key (evidenceNoProviderAttempt=true)
  --dry-run     Check reservation state and determine if reconciliation is required without modifying DB

Options:
  --actor <name> Operator identifier for ops_events audit (default: operator_cli)
  -h, --help     Show this help message

Examples:
  # Check status:
  node scripts/reconcile-payment-notification.mjs b0f1b2c3-4d5e-6f7a-8b9c-0d1e2f3a4b5c --dry-run

  # When verified sent in LINE OA / staff group:
  node scripts/reconcile-payment-notification.mjs b0f1b2c3-4d5e-6f7a-8b9c-0d1e2f3a4b5c --mark-sent

  # When verified NOT sent anywhere:
  node scripts/reconcile-payment-notification.mjs b0f1b2c3-4d5e-6f7a-8b9c-0d1e2f3a4b5c --safe-retry
`);
}

function parseArgs(argv) {
  let reservationId = null;
  let markSent = false;
  let safeRetry = false;
  let dryRun = false;
  let help = false;
  let actor = "operator_cli";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg === "--mark-sent") {
      markSent = true;
    } else if (arg === "--safe-retry") {
      safeRetry = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--actor") {
      actor = argv[++i] || actor;
    } else if (!arg.startsWith("-") && !reservationId) {
      reservationId = arg;
    }
  }

  return { reservationId, markSent, safeRetry, dryRun, actor, help };
}

// Re-exec under tsx loader if running under raw Node without tsx
if (!process.env.__TSX_RECONCILE_LOADED__) {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    printHelp();
    process.exit(0);
  }
  if (!parsed.reservationId) {
    console.error("Error: Missing required <reservation_id>");
    printHelp();
    process.exit(1);
  }
  if ((parsed.markSent ? 1 : 0) + (parsed.safeRetry ? 1 : 0) + (parsed.dryRun ? 1 : 0) !== 1) {
    console.error("Error: Must specify exactly one of --mark-sent, --safe-retry, or --dry-run");
    printHelp();
    process.exit(1);
  }

  const result = spawnSync("npx", ["tsx", fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: ROOT,
    env: { ...process.env, __TSX_RECONCILE_LOADED__: "1" },
  });
  process.exit(result.status ?? 0);
}

// Below runs under tsx
const {
  verifyReconciliationRequired,
  reconcilePaymentNotificationMarkSent,
  reconcilePaymentNotificationSafeRetry,
} = await import("../src/lib/payment-notify.ts");
const { createClient } = await import("@supabase/supabase-js");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error("Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment or .env.local");
    process.exit(1);
  }

  const client = createClient(supabaseUrl, serviceKey);

  console.log(`[reconcile-payment-notification] Verifying reservation ${args.reservationId}...`);
  const verify = await verifyReconciliationRequired(args.reservationId, client);

  if (!verify.ok) {
    console.error(`[FAIL-CLOSED] Reservation ${args.reservationId} is NOT in reconciliation_required state:`);
    console.error(`  Error:  ${verify.error}`);
    console.error(`  Reason: ${verify.reason}`);
    process.exit(1);
  }

  const r = verify.reservation;
  console.log(`[OK] Found reconciliation-required reservation:`);
  console.log(`  Booking Code:    ${r.booking_code}`);
  console.log(`  Customer:        ${r.customer_name}`);
  console.log(`  Deposit Paid:    ${r.is_deposit_paid}`);
  console.log(`  Notified At:     ${r.deposit_approved_notified_at ?? "NULL (unresolved)"}`);
  console.log(`  Retry Key:       ${r.deposit_approved_retry_key}`);
  console.log(`  Key Created At:  ${r.deposit_approved_retry_key_created_at} (>24h expired)`);

  if (args.dryRun) {
    console.log("\n[DRY RUN] Verification complete. No modifications were made.");
    console.log("  To resolve without sending: run with --mark-sent");
    console.log("  To resolve by dispatching:  run with --safe-retry");
    process.exit(0);
  }

  if (args.markSent) {
    console.log("\n[ACTION: MARK-SENT] Resolving canonical notification state without sending LINE...");
    const res = await reconcilePaymentNotificationMarkSent(args.reservationId, {
      actor: args.actor,
      client,
    });
    if (!res.ok) {
      console.error(`[ERROR] Mark-sent failed: ${res.error} - ${res.reason}`);
      process.exit(1);
    }
    console.log(`[SUCCESS] Marked as sent!`);
    console.log(`  Reservation: ${res.reservation_id} (${res.booking_code})`);
    console.log(`  Notified At: ${res.notified_at}`);
    console.log(`  Audit Event: recorded in ops_events (action: payment.approved_notification_reconciled, method: mark_sent)`);
    process.exit(0);
  }

  if (args.safeRetry) {
    console.log("\n[ACTION: SAFE-RETRY] Invoking canonical notification with explicit evidenceNoProviderAttempt=true...");
    const res = await reconcilePaymentNotificationSafeRetry(args.reservationId, {
      actor: args.actor,
      client,
    });
    if (!res.ok) {
      console.error(`[ERROR] Safe-retry failed: ${res.error} - ${res.reason}`);
      process.exit(1);
    }
    console.log(`[SUCCESS] Safe-retry completed!`);
    console.log(`  Reservation:    ${res.reservation_id} (${res.booking_code})`);
    console.log(`  Group Notified: ${res.notify_result?.group_notified ?? false}`);
    console.log(`  Guest Notified: ${res.notify_result?.guest_notified ?? false}`);
    console.log(`  New Group Key:  ${res.notify_result?.group_retry_key}`);
    console.log(`  Audit Event:    recorded in ops_events (action: payment.approved_notification_reconciled, method: safe_retry)`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
