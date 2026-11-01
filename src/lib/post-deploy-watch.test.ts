import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decide, runRound, watch } from "../../scripts/post-deploy-watch.mjs";

const root = process.cwd();
const SHA = "a".repeat(40);
const OLD = "b".repeat(40);
const ID = "dpl_syntheticA";
const workflow = readFileSync(join(root, ".github/workflows/production-deploy-migrate.yml"), "utf8");

type Spec = { version?: string | null; deploymentId?: string | null; health?: boolean; pages?: number; auth?: number; throwAll?: boolean };
function fakeFetch(spec: () => Spec) {
  return async (url: string) => {
    const s = spec();
    if (s.throwAll) throw new Error("network");
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const json = (body: unknown, status = 200) => ({ status, ok: status < 400, headers: { get: () => "application/json" }, json: async () => body });
    if (path === "/api/version") return s.version === null ? json({}, 503) : json({ commit: s.version ?? SHA, deployment_id: s.deploymentId === undefined ? ID : s.deploymentId });
    if (path === "/api/booking-health") return json({ ok: s.health ?? true }, s.health === false ? 503 : 200);
    if (path.startsWith("/api/reservations/")) return json({}, s.auth ?? 401);
    return { status: s.pages ?? 200, ok: true, headers: { get: () => "text/html" }, json: async () => ({}) };
  };
}
const noSleep = async () => {};
const run = (spec: () => Spec, extra = {}) =>
  watch({ base: "https://x.test", expectedSha: SHA, expectedDeploymentId: ID, minutes: 15, intervalSeconds: 30, failRounds: 5, fetchImpl: fakeFetch(spec) as never, sleep: noSleep, log: () => {}, ...extra });

describe("post-deploy watch", () => {
  it("is healthy when every probe passes for the whole window", async () => {
    const r = await run(() => ({}));
    expect(r).toMatchObject({ exitCode: 0, verdict: "healthy", rounds: 30 });
  });

  it("tolerates a transient blip (2 failing rounds, fewer than 5 consecutive)", async () => {
    let round = 0;
    const calls = fakeFetch(() => ({ health: round !== 3 && round !== 4 }));
    const out = await watch({ base: "https://x.test", expectedSha: SHA, expectedDeploymentId: ID, fetchImpl: ((u: string, i: unknown) => { if (u.endsWith("/api/version")) round++; return (calls as never as (u: string, i: unknown) => unknown)(u, i); }) as never, sleep: noSleep, log: () => {}, failRounds: 5 });
    expect(out.exitCode).toBe(0);
  });

  it("reports sustained failure for immediate operator response", async () => {
    const r = await run(() => ({ health: false }));
    expect(r).toMatchObject({ exitCode: 10, verdict: "sustained_failure", rounds: 5 });
    expect(r.lastFailed).toContain("booking-health:503");
  });

  it("counts page 5xx, auth regression and an unreachable /api/version as failures", async () => {
    expect((await run(() => ({ pages: 500 }))).exitCode).toBe(10);
    expect((await run(() => ({ auth: 200 }))).lastFailed).toContain("auth-smoke:200");
    let first = true;
    const flaky = await run(() => { const v = first ? undefined : null; first = false; return { version: v }; });
    expect(flaky.exitCode).toBe(10);
    expect(flaky.lastFailed).toContain("identity:unavailable");
  });

  it("never rolls back when production serves a different SHA (not ours or superseded)", async () => {
    const never = await run(() => ({ version: OLD, health: false }));
    expect(never).toMatchObject({ exitCode: 11, verdict: "identity_unverified" });
    let n = 0;
    const superseded = await run(() => ({ version: ++n > 12 ? OLD : SHA, health: false, pages: 500 }), {});
    expect([10, 11]).toContain(superseded.exitCode);
    const d = decide({ consecutive: 4, lastFailed: [], verdict: "continue" }, { version: OLD, deploymentId: ID, matches: false, probes: [], failed: ["home:500"] }, { failRounds: 5 });
    expect(d.verdict).toBe("superseded");
  });

  it("stops if another deployment serves the same commit", async () => {
    let calls = 0;
    const d = await run(() => ({ deploymentId: ++calls > 6 ? "dpl_other" : ID }));
    expect(d).toMatchObject({ exitCode: 11, verdict: "superseded" });
  });

  it("does not attribute failures when the expected deployment identity is absent", async () => {
    expect(await run(() => ({ health: false }), { expectedDeploymentId: "" })).toMatchObject({ exitCode: 11, verdict: "identity_unverified", rounds: 0 });
    expect(await run(() => ({ deploymentId: null, health: false }))).toMatchObject({ exitCode: 11, verdict: "identity_unverified" });
    expect(await run(() => ({ version: "invalid", health: false }))).toMatchObject({ exitCode: 11, verdict: "identity_unverified" });
  });

  it("does not report healthy if the last observed deployment identity is unknown", async () => {
    let calls = 0;
    const result = await run(() => ({ deploymentId: ++calls > 29 * 6 ? null : ID }));
    expect(result).toMatchObject({ exitCode: 11, verdict: "identity_unverified", rounds: 30 });
  });

  it("does not judge propagation lag before the first matching version", async () => {
    let n = 0;
    const r = await run(() => (++n <= 6 ? { version: OLD, health: false } : {}));
    expect(r.exitCode === 0 || r.exitCode === 10).toBe(true);
    expect((await run(() => ({ version: OLD }))).exitCode).toBe(11);
  });

  it("round probes only runtime endpoints, never migration drift", async () => {
    const seen: string[] = [];
    await runRound({ base: "https://x.test", expectedSha: SHA, expectedDeploymentId: ID, fetchImpl: (async (u: string) => { seen.push(u); return { status: 200, ok: true, headers: { get: () => "application/json" }, json: async () => ({ ok: true, commit: SHA, deployment_id: ID }) }; }) as never });
    expect(seen.join(" ")).not.toMatch(/deploy-health|drift|migration/i);
    expect(seen).toContain("https://x.test/api/booking-health");
  });
});

describe("post_deploy_watch job wiring", () => {
  const job = workflow.slice(workflow.indexOf("  post_deploy_watch:\n"));

  it("runs after deploy even if postdeploy checks failed, and scopes to runtime health only", () => {
    expect(job).toMatch(/needs: \[deploy, postdeploy_verify\]/);
    expect(job).toMatch(/always\(\) && needs\.deploy\.result != 'skipped'/);
    expect(job).toContain("EXPECTED_DEPLOYMENT_ID: ${{ needs.deploy.outputs.deployment_id }}");
    expect(job).not.toMatch(/deploy-health|check-migration-drift|true_pending|verify-production|migration-plan/i);
  });

  it("opens an incident instead of an unfenced automatic rollback", () => {
    expect(job).toMatch(/verdict == 'sustained_failure'/);
    expect(job).toMatch(/verdict == 'identity_unverified'/);
    expect(job).toMatch(/verdict == 'superseded'/);
    expect(job).not.toMatch(/npx vercel rollback/);
    expect(job).toMatch(/gh issue (create|comment)/);
    expect(job).toMatch(/issues: write/);
    expect(job).toMatch(/node scripts\/post-deploy-watch\.mjs/);
    expect(job).toMatch(/Fail the run if deployment identity is unknown or superseded/);
    expect(job).toMatch(/VERDICT: \$\{\{ steps\.watch\.outputs\.verdict \}\}/);
  });

  it("tells operators how to respond and promote after a rollback", () => {
    expect(job).toMatch(/stops auto-assigning the production domain/);
    expect(job).toMatch(/vercel promote/);
    expect(readFileSync(join(root, "docs/RUNBOOK.md"), "utf8")).toMatch(/vercel promote/);
    expect(readFileSync(join(root, "docs/plans/2026-11-deploy-before-postdeploy.md"), "utf8")).toMatch(/Immediate manual response/);
  });

  it("is not defined as a second production deploy writer (verify:production-workflow contract)", () => {
    expect(job).not.toMatch(/vercel\s+(deploy|redeploy|alias)/);
  });
});
