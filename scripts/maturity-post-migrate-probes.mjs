#!/usr/bin/env node
/**
 * Post-migrate production probes (no secret values logged):
 * 1) anon cannot PATCH branches (negative)
 * 2) service role can PATCH then restore a safe no-op field (positive admin path)
 * 3) schema_migrations contains maturity versions
 */
import {
  logEnvPresence,
  anonKeyLooksReal,
  serviceKeyLooksReal,
  restProbe,
} from "./maturity-migrate-lib.mjs";

async function main() {
  console.log("=== Post-migrate probes ===");
  const env = logEnvPresence();
  if (!serviceKeyLooksReal(env.service)) {
    console.error("BLOCKED: need real service role key (repo or Production environment)");
    process.exit(2);
  }
  const base = env.url.replace(/\/$/, "");

  // Load one branch id via service role
  const list = await fetch(`${base}/rest/v1/branches?select=id,name&limit=1`, {
    headers: {
      apikey: env.service,
      Authorization: `Bearer ${env.service}`,
    },
  });
  const rows = await list.json();
  if (!Array.isArray(rows) || !rows[0]?.id) {
    throw new Error("No branch available for probes");
  }
  const branchId = rows[0].id;
  const originalName = rows[0].name;

  // Negative: anon PATCH must fail (401/403/42501) when anon key is configured
  if (anonKeyLooksReal(env.anon)) {
    const anonPatch = await fetch(
      `${base}/rest/v1/branches?id=eq.${encodeURIComponent(branchId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: env.anon,
          Authorization: `Bearer ${env.anon}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ name: `${originalName}` }),
      }
    );
    const anonOk = anonPatch.status >= 400;
    console.log(
      JSON.stringify({
        probe: "anon_patch_branches",
        http: anonPatch.status,
        pass: anonOk,
        expect: "4xx (denied)",
      })
    );
    if (!anonOk) {
      throw new Error("ANON_PATCH_ALLOWED — RLS catalog harden failed");
    }
  } else {
    console.log(
      JSON.stringify({
        probe: "anon_patch_branches",
        skipped: true,
        reason: "NEXT_PUBLIC_SUPABASE_ANON_KEY unset — SQL policy probe in apply job is authoritative",
      })
    );
  }

  // Positive: service role PATCH same name (no-op semantics) must succeed
  const svcPatch = await fetch(`${base}/rest/v1/branches?id=eq.${encodeURIComponent(branchId)}`, {
    method: "PATCH",
    headers: {
      apikey: env.service,
      Authorization: `Bearer ${env.service}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ name: originalName }),
  });
  console.log(
    JSON.stringify({
      probe: "service_role_patch_branches",
      http: svcPatch.status,
      pass: svcPatch.status >= 200 && svcPatch.status < 300,
    })
  );
  if (svcPatch.status < 200 || svcPatch.status >= 300) {
    const t = await svcPatch.text();
    throw new Error(`SERVICE_PATCH_FAILED HTTP ${svcPatch.status}: ${t.slice(0, 120)}`);
  }

  // Migration versions via REST — RLS catalog version is required for Verify Production
  const mig = await restProbe(
    env.url,
    env.service,
    "/rest/v1/schema_migrations?select=version&version=in.(20260715-rls-catalog-read-only,20260715-refund-requests)"
  );
  console.log(
    JSON.stringify({
      probe: "schema_migrations",
      http: mig.status,
      body_preview: mig.body,
    })
  );
  if (mig.status !== 200 || !mig.body.includes("20260715-rls-catalog-read-only")) {
    throw new Error("LEDGER_MISSING_RLS_CATALOG — schema_migrations lacks 20260715-rls-catalog-read-only");
  }

  console.log("PROBES_OK");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
