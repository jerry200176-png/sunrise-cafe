#!/usr/bin/env node
/**
 * Post-deploy runtime watch (Gap #3, RULEBOOK D6/D7). Polls production for a window
 * after the Vercel deploy and reports whether failures are sustained.
 *
 * Scope is RUNTIME HEALTH ONLY: version identity, public pages, booking-health
 * (DB reachability), auth smoke. It deliberately does NOT read migration drift
 * (Verify Production / deploy-health sha_parity), so a known drift issue can never
 * trigger a rollback.
 *
 * Exit codes: 0 healthy, 10 sustained runtime failure, 11 identity unknown / superseded.
 * This draft never automatically rolls back: a sampled identity cannot fence other writers.
 * Env: PRODUCTION_URL, EXPECTED_SHA, EXPECTED_DEPLOYMENT_ID, WATCH_MINUTES, INTERVAL_SECONDS, FAIL_ROUNDS
 */

export const PROBES = [
  { name: "home", path: "/", expect: (r) => r.status === 200 },
  { name: "book-page", path: "/book", expect: (r) => r.status === 200 },
  { name: "menu-page", path: "/menu", expect: (r) => r.status === 200 },
  { name: "booking-health", path: "/api/booking-health", expect: (r) => r.status === 200 && r.json?.ok === true },
  {
    name: "auth-smoke",
    path: "/api/reservations/00000000-0000-0000-0000-000000000099",
    init: { method: "PATCH", headers: { "Content-Type": "application/json" }, body: '{"notes":"watch"}' },
    expect: (r) => r.status === 401,
  },
];

async function probe(base, p, fetchImpl) {
  try {
    const res = await fetchImpl(base + p.path, { ...(p.init ?? {}), redirect: "manual", signal: AbortSignal.timeout(15000) });
    let json = null;
    if ((res.headers.get?.("content-type") ?? "").includes("json")) json = await res.json().catch(() => null);
    const r = { status: res.status, json };
    return { name: p.name, ok: p.expect(r), status: res.status };
  } catch {
    return { name: p.name, ok: false, status: 0 };
  }
}

const isDeploymentId = (value) => typeof value === "string" && /^dpl_[A-Za-z0-9]+$/.test(value);
const isCommit = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);

export async function runRound({ base, expectedSha, expectedDeploymentId, fetchImpl }) {
  let version = null;
  let deploymentId = null;
  try {
    const res = await fetchImpl(`${base}/api/version`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    const body = res.ok ? await res.json() : null;
    version = isCommit(body?.commit) ? body.commit : null;
    deploymentId = isDeploymentId(body?.deployment_id) ? body.deployment_id : null;
  } catch { /* treated as unknown version */ }
  const probes = await Promise.all(PROBES.map((p) => probe(base, p, fetchImpl)));
  const failed = probes.filter((p) => !p.ok).map((p) => `${p.name}:${p.status}`);
  if (version === null || deploymentId === null) failed.unshift("identity:unavailable");
  return { version, deploymentId, matches: version === expectedSha && deploymentId === expectedDeploymentId, probes, failed };
}

/** Pure decision step. `state` carries consecutive failures. */
export function decide(state, round, { failRounds }) {
  if (round.version && round.deploymentId && !round.matches) return { ...state, verdict: "superseded" };
  const failing = round.failed.length > 0;
  const consecutive = failing ? state.consecutive + 1 : 0;
  return { consecutive, lastFailed: failing ? round.failed : state.lastFailed, verdict: consecutive >= failRounds ? "sustained_failure" : "continue" };
}

export async function watch({ base, expectedSha, expectedDeploymentId, minutes = 15, intervalSeconds = 30, failRounds = 5, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log }) {
  if (!isCommit(expectedSha) || !isDeploymentId(expectedDeploymentId)) return { exitCode: 11, verdict: "identity_unverified", consecutive: 0, lastFailed: ["identity:unavailable"], rounds: 0 };
  const rounds = Math.max(1, Math.floor((minutes * 60) / intervalSeconds));
  let state = { consecutive: 0, lastFailed: [], verdict: "continue" };
  let sawOurs = false;
  let lastIdentityMatched = false;
  for (let i = 1; i <= rounds; i++) {
    const round = await runRound({ base, expectedSha, expectedDeploymentId, fetchImpl });
    lastIdentityMatched = round.matches;
    if (round.matches) sawOurs = true;
    // Before the first match (propagation lag) or if production never serves our SHA: do not judge, never roll back.
    if (!sawOurs && !round.matches) {
      log(`round ${i}/${rounds}: production serves ${round.version ?? "unknown"} not ${expectedSha.slice(0, 7)} (not judged)`);
    } else {
      state = decide(state, round, { failRounds });
      log(`round ${i}/${rounds}: ${round.failed.length ? "FAIL " + round.failed.join(",") : "ok"} consecutive=${state.consecutive}`);
      if (state.verdict === "superseded") return { exitCode: 11, ...state, rounds: i };
      if (state.verdict === "sustained_failure") return { exitCode: 10, ...state, rounds: i };
    }
    if (i < rounds) await sleep(intervalSeconds * 1000);
  }
  if (!sawOurs) return { exitCode: 11, verdict: "identity_unverified", consecutive: 0, lastFailed: ["identity:unverified"], rounds };
  if (!lastIdentityMatched) return { exitCode: 11, ...state, verdict: "identity_unverified", lastFailed: ["identity:unavailable"], rounds };
  return { exitCode: 0, ...state, verdict: "healthy", rounds };
}

async function main() {
  const base = (process.env.PRODUCTION_URL ?? "").replace(/\/$/, "");
  const expectedSha = process.env.EXPECTED_SHA ?? "";
  if (!base || !expectedSha) throw new Error("PRODUCTION_URL and EXPECTED_SHA are required");
  const result = await watch({
    base,
    expectedSha,
    expectedDeploymentId: process.env.EXPECTED_DEPLOYMENT_ID ?? "",
    minutes: Number(process.env.WATCH_MINUTES ?? 15),
    intervalSeconds: Number(process.env.INTERVAL_SECONDS ?? 30),
    failRounds: Number(process.env.FAIL_ROUNDS ?? 5),
  });
  console.log(JSON.stringify({ verdict: result.verdict, rounds: result.rounds, last_failed: result.lastFailed }));
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${result.verdict}\nfailed=${(result.lastFailed ?? []).join(",")}\n`);
  }
  process.exit(result.exitCode);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
