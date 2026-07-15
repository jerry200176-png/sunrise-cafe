#!/usr/bin/env node
/**
 * Preflight before catalog RLS / refund migrations.
 * Ensures production app already contains service-role write path
 * (so applying SELECT-only RLS won't break admin CRUD).
 *
 * Exit 0 = safe to proceed
 * Exit 2 = blocked (deploy order / missing secrets)
 */
import {
  logEnvPresence,
  dbUrlLooksReal,
  serviceKeyLooksReal,
  resolveDbUrl,
} from "./maturity-migrate-lib.mjs";

const PRODUCTION_URL =
  process.env.PRODUCTION_URL ?? "https://sunrise-cafe-six.vercel.app";

async function main() {
  console.log("=== Maturity migrate preflight ===");
  const env = logEnvPresence();
  const db = resolveDbUrl();

  if (!serviceKeyLooksReal(env.service)) {
    console.error("BLOCKED: SUPABASE_SERVICE_ROLE_KEY missing or not JWT-shaped");
    process.exit(2);
  }
  if (!dbUrlLooksReal(db)) {
    console.error("BLOCKED: Postgres URL missing or placeholder (secrets stay in GitHub Environment)");
    process.exit(2);
  }

  // Production must expose payment/status (Maturity A marker) = service-role write PR deployed
  const verRes = await fetch(`${PRODUCTION_URL}/api/version`);
  const ver = await verRes.json().catch(() => ({}));
  console.log(
    JSON.stringify({
      production_commit: ver.commit ?? null,
      production_reachable: verRes.ok,
    })
  );

  const statusRes = await fetch(`${PRODUCTION_URL}/api/payment/status`);
  const statusOk = statusRes.ok;
  let statusBody = {};
  try {
    statusBody = await statusRes.json();
  } catch {
    /* ignore */
  }
  console.log(
    JSON.stringify({
      payment_status_http: statusRes.status,
      stripe_enabled: statusBody.stripe_enabled ?? null,
      deposit_capture: statusBody.deposit_capture ?? null,
    })
  );

  if (!statusOk) {
    console.error(
      "BLOCKED: /api/payment/status missing on production — deploy Maturity A app (service-role writes) BEFORE RLS migrate"
    );
    process.exit(2);
  }

  // Health should advertise rate_limit_mode after maturity deploy
  const healthRes = await fetch(`${PRODUCTION_URL}/api/booking-health`);
  const health = await healthRes.json().catch(() => ({}));
  console.log(
    JSON.stringify({
      booking_health_ok: health.ok === true,
      rate_limit_mode: health.rate_limit_mode ?? null,
      note:
        health.rate_limit_mode == null
          ? "rate_limit_mode absent — confirm maturity commit is live (public health may omit details)"
          : null,
    })
  );

  console.log("PREFLIGHT_OK: deploy order satisfied; secrets present (not printed)");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
