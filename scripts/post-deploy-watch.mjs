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
 * Exit codes: 0 healthy, 10 sustained runtime failure (workflow rolls back),
 *             11 not our deploy / superseded (workflow never rolls back).
 * Env: PRODUCTION_URL, EXPECTED_SHA, WATCH_MINUTES (15), INTERVAL_SECONDS (30), FAIL_ROUNDS (5)
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

export async function runRound({ base, expectedSha, fetchImpl }) {
  let version = null;
  try {
    const res = await fetchImpl(`${base}/api/version`, { signal: AbortSignal.timeout(15000) });
    version = res.ok ? ((await res.json())?.commit ?? null) : null;
  } catch { /* treated as unknown version */ }
  const probes = await Promise.all(PROBES.map((p) => probe(base, p, fetchImpl)));
  const failed = probes.filter((p) => !p.ok).map((p) => `${p.name}:${p.status}`);
  if (version === null) failed.unshift("version:unavailable"); // /api/version down counts as a failure once we have seen our SHA
  return { version, matches: version === expectedSha, probes, failed };
}

/** Pure decision step. `state` carries consecutive failures. */
export function decide(state, round, { failRounds }) {
  if (round.version && !round.matches) return { ...state, verdict: "superseded" };
  const failing = round.failed.length > 0;
  const consecutive = failing ? state.consecutive + 1 : 0;
  return { consecutive, lastFailed: failing ? round.failed : state.lastFailed, verdict: consecutive >= failRounds ? "sustained_failure" : "continue" };
}

export async function watch({ base, expectedSha, minutes = 15, intervalSeconds = 30, failRounds = 5, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log }) {
  const rounds = Math.max(1, Math.floor((minutes * 60) / intervalSeconds));
  let state = { consecutive: 0, lastFailed: [], verdict: "continue" };
  let sawOurs = false;
  for (let i = 1; i <= rounds; i++) {
    const round = await runRound({ base, expectedSha, fetchImpl });
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
  if (!sawOurs) return { exitCode: 11, verdict: "never_served_expected_sha", consecutive: 0, lastFailed: [], rounds };
  return { exitCode: 0, ...state, verdict: "healthy", rounds };
}

async function main() {
  const base = (process.env.PRODUCTION_URL ?? "").replace(/\/$/, "");
  const expectedSha = process.env.EXPECTED_SHA ?? "";
  if (!base || !expectedSha) throw new Error("PRODUCTION_URL and EXPECTED_SHA are required");
  const result = await watch({
    base,
    expectedSha,
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
