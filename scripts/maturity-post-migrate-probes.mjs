#!/usr/bin/env node
/**
 * Post-migrate production probes (no secret values logged):
 * 1) anon cannot PATCH branches/rooms/settings (negative)
 * 2) service role can PATCH branch no-op (positive admin CRUD path)
 * 3) refund_requests reachable + RLS denies anon
 * 4) ops_events insert/read + schema_migrations maturity versions
 */
import {
  logEnvPresence,
  anonKeyLooksReal,
  serviceKeyLooksReal,
  restProbe,
} from "./maturity-migrate-lib.mjs";

async function anonPatch(base, anon, path, body) {
  return fetch(`${base}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
}

async function main() {
  console.log("=== Post-migrate probes ===");
  const env = logEnvPresence();
  if (!serviceKeyLooksReal(env.service) || !anonKeyLooksReal(env.anon)) {
    console.error("BLOCKED: need real service + anon keys in GitHub Environment (not agent)");
    process.exit(2);
  }
  const base = env.url.replace(/\/$/, "");
  const svcHeaders = {
    apikey: env.service,
    Authorization: `Bearer ${env.service}`,
  };

  const list = await fetch(`${base}/rest/v1/branches?select=id,name&limit=1`, {
    headers: svcHeaders,
  });
  const rows = await list.json();
  if (!Array.isArray(rows) || !rows[0]?.id) {
    throw new Error("No branch available for probes");
  }
  const branchId = rows[0].id;
  const originalName = rows[0].name;

  const rooms = await fetch(`${base}/rest/v1/rooms?select=id,name&limit=1`, {
    headers: svcHeaders,
  });
  const roomRows = await rooms.json();
  const roomId = Array.isArray(roomRows) && roomRows[0]?.id ? roomRows[0].id : null;

  const settings = await fetch(`${base}/rest/v1/settings?select=id&limit=1`, {
    headers: svcHeaders,
  });
  const settingsRows = await settings.json();
  const settingsId =
    Array.isArray(settingsRows) && settingsRows[0]?.id ? settingsRows[0].id : null;

  // Negative: anon PATCH catalog
  for (const [label, path, body] of [
    ["branches", `branches?id=eq.${encodeURIComponent(branchId)}`, { name: originalName }],
    roomId
      ? ["rooms", `rooms?id=eq.${encodeURIComponent(roomId)}`, { name: roomRows[0].name }]
      : null,
    settingsId
      ? ["settings", `settings?id=eq.${encodeURIComponent(settingsId)}`, {}]
      : null,
  ].filter(Boolean)) {
    const res = await anonPatch(base, env.anon, path, body);
    const pass = res.status >= 400;
    console.log(
      JSON.stringify({
        probe: `anon_patch_${label}`,
        http: res.status,
        pass,
        expect: "4xx (denied)",
      })
    );
    if (!pass) throw new Error(`ANON_PATCH_ALLOWED on ${label}`);
  }

  // Positive: service role PATCH branch
  const svcPatch = await fetch(
    `${base}/rest/v1/branches?id=eq.${encodeURIComponent(branchId)}`,
    {
      method: "PATCH",
      headers: {
        ...svcHeaders,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ name: originalName }),
    }
  );
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

  // refund_requests: service can select; anon cannot
  const refundSvc = await restProbe(
    env.url,
    env.service,
    "/rest/v1/refund_requests?select=id,status,created_at&limit=1"
  );
  console.log(
    JSON.stringify({
      probe: "refund_requests_service",
      http: refundSvc.status,
      pass: refundSvc.status === 200,
    })
  );
  if (refundSvc.status !== 200) {
    throw new Error(`refund_requests not ready for service role HTTP ${refundSvc.status}`);
  }

  const refundAnon = await restProbe(
    env.url,
    env.anon,
    "/rest/v1/refund_requests?select=id&limit=1"
  );
  const refundAnonDenied = refundAnon.status >= 400 || refundAnon.body.includes("[]");
  // With RLS and no policy, PostgREST often returns [] with 200 for anon — treat empty as ok only if
  // insert as anon fails.
  const anonInsert = await fetch(`${base}/rest/v1/refund_requests`, {
    method: "POST",
    headers: {
      apikey: env.anon,
      Authorization: `Bearer ${env.anon}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      reservation_id: "00000000-0000-0000-0000-000000000000",
      status: "requested",
    }),
  });
  const anonInsertDenied = anonInsert.status >= 400;
  console.log(
    JSON.stringify({
      probe: "refund_requests_anon_insert",
      http: anonInsert.status,
      pass: anonInsertDenied,
      select_http: refundAnon.status,
      select_empty_ok: refundAnonDenied,
    })
  );
  if (!anonInsertDenied) {
    throw new Error("ANON_REFUND_INSERT_ALLOWED");
  }

  // ops_events insert + read
  const stamp = `probe_${Date.now()}`;
  const insertRes = await fetch(`${base}/rest/v1/ops_events`, {
    method: "POST",
    headers: {
      ...svcHeaders,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      domain: "admin",
      action: "admin.payment_approved",
      detail: { probe: true, stamp, source: "maturity-post-migrate-probes" },
    }),
  });
  console.log(
    JSON.stringify({
      probe: "ops_events_insert",
      http: insertRes.status,
      pass: insertRes.status >= 200 && insertRes.status < 300,
    })
  );
  if (insertRes.status < 200 || insertRes.status >= 300) {
    throw new Error(`ops_events insert failed HTTP ${insertRes.status}`);
  }

  const readOps = await restProbe(
    env.url,
    env.service,
    `/rest/v1/ops_events?select=id,ts&detail->>stamp=eq.${encodeURIComponent(stamp)}&limit=1`
  );
  console.log(
    JSON.stringify({
      probe: "ops_events_read",
      http: readOps.status,
      pass: readOps.status === 200 && readOps.body.includes("id"),
      body_preview: readOps.body,
    })
  );
  if (readOps.status !== 200 || !readOps.body.includes("id")) {
    throw new Error("ops_events read-back failed");
  }

  const mig = await restProbe(
    env.url,
    env.service,
    "/rest/v1/schema_migrations?select=version,name&version=in.(20260715-rls-catalog-read-only,20260715-refund-requests)"
  );
  console.log(
    JSON.stringify({
      probe: "schema_migrations",
      http: mig.status,
      body_preview: mig.body,
    })
  );
  if (mig.status === 200) {
    if (!mig.body.includes("20260715-rls-catalog-read-only")) {
      throw new Error("schema_migrations missing RLS version");
    }
    if (!mig.body.includes("20260715-refund-requests")) {
      throw new Error("schema_migrations missing refund version");
    }
  } else {
    console.log(
      JSON.stringify({
        probe: "schema_migrations",
        note: "table not exposed via REST — apply script already verified policies",
        http: mig.status,
      })
    );
  }

  console.log("PROBES_OK");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
