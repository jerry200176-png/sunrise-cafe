import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const script = join(root, "scripts/pre-migration-backup.sh");
const workflow = readFileSync(join(root, ".github/workflows/production-deploy-migrate.yml"), "utf8");
const SECRET_URL = "postgresql://postgres.ref:S3CR3T-PW@aws-0-x.pooler.supabase.com:5432/postgres";

/** Fake PG_RUNNER: behaves like `docker run postgres:17 <cmd>`; behaviour chosen by FAKE_MODE. */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "pmb-"));
  const runner = join(dir, "fake-pg");
  writeFileSync(
    runner,
    `#!/usr/bin/env bash
mode="\${FAKE_MODE:-ok}"
if [[ "$1" == "sh" ]]; then               # pg_dump
  [[ "$mode" == "dump_fail" ]] && { echo "boom $SUPABASE_DB_URL" >&2; exit 1; }
  [[ "$mode" == "tiny" ]] && { echo -n tiny; exit 0; }
  head -c 4096 /dev/urandom; exit 0
fi
if [[ "$1" == "pg_restore" ]]; then
  [[ "$mode" == "bad_toc" ]] && exit 1
  echo "; TOC"; [[ "$mode" == "no_reservations" ]] && exit 0
  echo "5; 0 1 TABLE DATA public reservations postgres"
  echo "6; 0 2 TABLE DATA public rooms postgres"; exit 0
fi
exit 2
`
  );
  chmodSync(runner, 0o755);
  return { dir, runner };
}

function run(mode: string, extra: Record<string, string> = {}) {
  const { dir, runner } = setup();
  const out = join(dir, "out");
  const summary = join(dir, "summary.md");
  const res = spawnSync("bash", [script, "predeploy"], {
    env: { PATH: process.env.PATH ?? "", SUPABASE_DB_URL: SECRET_URL, PG_RUNNER: runner, FAKE_MODE: mode, BACKUP_OUT_DIR: out, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: join(dir, "gh-output"), ...extra } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  return { res, out, dir, summary, all: res.stdout + res.stderr };
}

describe("pre-migration-backup.sh", () => {
  it("verifies the dump and records size + sha256 without uploading when no key is set", () => {
    const r = run("ok");
    expect(r.res.status).toBe(0);
    expect(r.all).toMatch(/bytes=4096 sha256=[0-9a-f]{64} tables_with_data=2 encrypted=false/);
    expect(readdirSync(r.out).some((f) => f.endsWith(".dump"))).toBe(true);
    expect(readFileSync(join(r.dir, "gh-output"), "utf8")).toContain("encrypted=false");
    expect(readFileSync(r.summary, "utf8")).toMatch(/NO RETAINED BACKUP/);
  });

  it.each(["dump_fail", "tiny", "bad_toc", "no_reservations"])("fails closed on %s and leaves no dump", (mode) => {
    const r = run(mode);
    expect(r.res.status).toBe(1);
    expect(r.all).toMatch(/pre-migration backup FAILED .*migrations will not run/);
    expect(readdirSync(r.out).filter((f) => f.endsWith(".dump") || f.endsWith(".age"))).toEqual([]);
  });

  it("never prints the connection string, even when pg_dump echoes it", () => {
    for (const mode of ["ok", "dump_fail"]) {
      const r = run(mode);
      expect(r.all).not.toContain("S3CR3T-PW");
      expect(readdirSync(r.out).includes("pg_dump.err")).toBe(false);
    }
  });

  it("refuses a missing or placeholder DB URL", () => {
    expect(run("ok", { SUPABASE_DB_URL: "" }).res.status).toBe(1);
    expect(run("ok", { SUPABASE_DB_URL: "postgresql://x@[region].pooler/postgres" }).res.status).toBe(1);
  });

  it("encrypts with age when BACKUP_AGE_RECIPIENT is set and deletes the plaintext", () => {
    const has = spawnSync("age-keygen", ["--version"]).status === 0;
    if (!has) return; // age is installed on the CI runner step; skipped locally when absent
    const dir = mkdtempSync(join(tmpdir(), "age-"));
    const key = execFileSync("age-keygen", ["-o", join(dir, "k.txt")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const pub = /age1[0-9a-z]{58}/.exec(key + readFileSync(join(dir, "k.txt"), "utf8"))![0];
    const r = run("ok", { BACKUP_AGE_RECIPIENT: pub });
    expect(r.res.status).toBe(0);
    const files = readdirSync(r.out);
    expect(files.some((f) => f.endsWith(".dump.age"))).toBe(true);
    expect(files.some((f) => f.endsWith(".dump"))).toBe(false);
    expect(existsSync(join(r.out, "manifest.json"))).toBe(true);
  });
});

describe("production-deploy-migrate.yml wiring", () => {
  const phaseBlock = (job: string) => {
    const i = workflow.indexOf(`  ${job}:\n`);
    const next = workflow.slice(i + 5).search(/\n  [a-z_]+:\n/);
    return workflow.slice(i, next < 0 ? undefined : i + 5 + next);
  };

  it.each([["predeploy_migrate", "predeploy"], ["postdeploy_migrate", "postdeploy"]])("%s orders backup -> upload -> verify -> migrate", (job, phase) => {
    const block = phaseBlock(job);
    const at = (needle: string) => block.indexOf(needle);
    const order = [
      "source scripts/resolve-db-url.sh",
      `bash scripts/pre-migration-backup.sh ${phase}`,
      "uses: actions/upload-artifact@v4",
      "Verify backup upload completed",
      `node scripts/run-production-migration-phase.mjs ${phase}`,
    ].map(at);
    expect(order.every((n) => n > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(block).not.toMatch(/if: \$\{\{ always\(\)/); // no always(): a failed upload must stop the migration step
    expect(block.match(/set -euo pipefail/g)?.length).toBeGreaterThan(1);
  });

  it("uploads only the age-encrypted artifact, short retention, gated on the key secret", () => {
    expect(workflow.match(/steps\.backup\.outputs\.encrypted == 'true'/g)).toHaveLength(4);
    expect(workflow.match(/retention-days: 3/g)).toHaveLength(2);
    expect(workflow).toMatch(/BACKUP_AGE_RECIPIENT: \$\{\{ secrets\.BACKUP_AGE_RECIPIENT \}\}/);
    expect(readFileSync(script, "utf8")).not.toMatch(/echo[^\n]*SUPABASE_DB_URL/);
  });
});
