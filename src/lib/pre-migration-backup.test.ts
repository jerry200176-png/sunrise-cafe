import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const script = join(root, "scripts/pre-migration-backup.sh");
const workflow = readFileSync(join(root, ".github/workflows/production-deploy-migrate.yml"), "utf8");
const SECRET_URL = "postgresql://postgres.ref:S3CR3T-PW@aws-0-x.pooler.supabase.com:5432/postgres";
const hasRealAge = spawnSync("age-keygen", ["--version"]).status === 0 && spawnSync("age", ["--version"]).status === 0;

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
  const age = join(dir, "age");
  writeFileSync(age, `#!/usr/bin/env bash\nif [[ "\${FAKE_AGE_FAIL:-}" == 1 ]]; then echo partial > "$4"; exit 1; fi\nprintf 'synthetic ciphertext' > "$4"\n`);
  chmodSync(age, 0o755);
  return { dir, runner };
}

function run(mode: string, extra: Record<string, string> = {}, fakeAge = true) {
  const { dir, runner } = setup();
  const out = join(dir, "out");
  const summary = join(dir, "summary.md");
  const res = spawnSync("bash", [script, "predeploy"], {
    env: { PATH: fakeAge ? `${dir}:${process.env.PATH ?? ""}` : process.env.PATH ?? "", BACKUP_AGE_RECIPIENT: "synthetic-recipient", SUPABASE_DB_URL: SECRET_URL, PG_RUNNER: runner, FAKE_MODE: mode, BACKUP_OUT_DIR: out, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: join(dir, "gh-output"), ...extra } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  return { res, out, dir, summary, all: res.stdout + res.stderr };
}

describe("pre-migration-backup.sh", () => {
  it("fails before dumping when recipient is missing", () => {
    const r = run("ok", { BACKUP_AGE_RECIPIENT: "" });
    expect(r.res.status).toBe(1);
    expect(r.all).toMatch(/BACKUP_AGE_RECIPIENT unset/);
    expect(existsSync(r.out)).toBe(false);
    expect(existsSync(join(r.dir, "gh-output"))).toBe(false);
  });

  it("encrypts the verified dump and records its integrity metadata", () => {
    const r = run("ok");
    expect(r.res.status).toBe(0);
    expect(r.all).toMatch(/bytes=4096 sha256=[0-9a-f]{64} tables_with_data=2 encrypted=true/);
    expect(readdirSync(r.out).some((f) => f.endsWith(".dump"))).toBe(false);
    expect(readdirSync(r.out).some((f) => f.endsWith(".dump.age"))).toBe(true);
    expect(readFileSync(join(r.dir, "gh-output"), "utf8")).toContain("encrypted=true");
    expect(readFileSync(r.summary, "utf8")).toContain("upload confirmation is required");
  });

  it("deletes plaintext and partial ciphertext when encryption fails", () => {
    const r = run("ok", { FAKE_AGE_FAIL: "1" });
    expect(r.res.status).toBe(1);
    expect(r.all).toMatch(/age encryption failed/);
    expect(readdirSync(r.out).filter((f) => f.endsWith(".dump") || f.endsWith(".age"))).toEqual([]);
    expect(existsSync(join(r.dir, "gh-output"))).toBe(false);
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

  it.skipIf(!hasRealAge)("encrypts a synthetic dump with age and verifies decrypted SHA-256", () => {
    const dir = mkdtempSync(join(tmpdir(), "age-"));
    const keyPath = join(dir, "synthetic-key.txt");
    const keygen = spawnSync("age-keygen", ["-o", keyPath], { encoding: "utf8" });
    expect(keygen.status).toBe(0);
    const pub = /age1[0-9a-z]{58}/.exec(keygen.stderr)![0];
    const r = run("ok", { BACKUP_AGE_RECIPIENT: pub }, false);
    expect(r.res.status).toBe(0);
    const files = readdirSync(r.out);
    expect(files.some((f) => f.endsWith(".dump.age"))).toBe(true);
    expect(files.some((f) => f.endsWith(".dump"))).toBe(false);
    expect(existsSync(join(r.out, "manifest.json"))).toBe(true);
    const encrypted = join(r.out, files.find((f) => f.endsWith(".dump.age"))!);
    const plain = execFileSync("age", ["-d", "-i", keyPath, encrypted]);
    const manifest = JSON.parse(readFileSync(join(r.out, "manifest.json"), "utf8"));
    expect(createHash("sha256").update(plain).digest("hex")).toBe(manifest.sha256);
  });
});

describe("production-deploy-migrate.yml wiring", () => {
  const phaseBlock = (job: string) => {
    const i = workflow.indexOf(`  ${job}:\n`);
    const next = workflow.slice(i + 5).search(/\n  [a-z_]+:\n/);
    return workflow.slice(i, next < 0 ? undefined : i + 5 + next);
  };

  it.each([["predeploy_migrate", "predeploy"], ["predeploy_verify", "predeploy"], ["postdeploy_migrate", "postdeploy"], ["postdeploy_verify", "postdeploy"]])("%s orders backup -> upload -> verify -> migrate", (job, phase) => {
    const block = phaseBlock(job);
    const at = (needle: string) => block.indexOf(needle);
    const order = [
      "source scripts/resolve-db-url.sh",
      `bash scripts/pre-migration-backup.sh ${phase}`,
      "uses: actions/upload-artifact@",
      "Verify backup upload completed",
      "scripts/verify-backup-upload.sh",
      `node scripts/run-production-migration-phase.mjs ${phase}`,
    ].map(at);
    expect(order.every((n) => n > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(block).not.toMatch(/if: \$\{\{ always\(\)/); // no always(): a failed upload must stop the migration step
    expect(block).not.toMatch(/continue-on-error:\s*true/);
    expect(block).not.toMatch(/steps\.backup\.outputs\.encrypted == 'true'/);
    expect(block).toContain("if-no-files-found: error");
    expect(block).toContain("${{ github.run_attempt }}");
    expect(block).toContain("BACKUP_ARTIFACT_ID: ${{ steps.upload.outputs.artifact-id }}");
    expect(block).toContain("BACKUP_ARTIFACT_DIGEST: ${{ steps.upload.outputs.artifact-digest }}");
    expect(block.match(/set -euo pipefail/g)?.length).toBeGreaterThan(1);
  });

  it("requires and uploads only the age-encrypted artifact for every executable phase job", () => {
    expect(workflow).not.toMatch(/steps\.backup\.outputs\.encrypted == 'true'/);
    const phaseJobs = ["predeploy_migrate", "predeploy_verify", "postdeploy_migrate", "postdeploy_verify"];
    for (const job of phaseJobs) {
      const block = phaseBlock(job);
      expect(block.startsWith(`  ${job}:\n`)).toBe(true);
      expect(block.match(/uses: actions\/upload-artifact@/g)).toHaveLength(1);
      expect(block.match(/retention-days: 3/g)).toHaveLength(1);
      expect(block).toContain('"$BACKUP_FILE" == *.dump.age');
      const uploadPaths = /path: \|\n([\s\S]*?)\n\s+retention-days:/.exec(block)?.[1]
        .split("\n").map((path) => path.trim());
      expect(uploadPaths).toEqual([
        "${{ steps.backup.outputs.artifact_path }}",
        "${{ steps.backup.outputs.manifest_path }}",
      ]);
    }
    // A fifth upload records a release incident, not a database backup.
    expect(workflow.match(/uses: actions\/upload-artifact@/g)).toHaveLength(5);
    const incident = phaseBlock("code_only_release");
    expect(isExpectedIncidentUpload(incident)).toBe(true);
    expect(isExpectedIncidentUpload(incident.replace(
      "path: ${{ runner.temp }}/sunrise-priority-release-incident.json",
      "path: ${{ runner.temp }}/unexpected.json"
    ))).toBe(false);
    expect(workflow).toMatch(/BACKUP_AGE_RECIPIENT: \$\{\{ secrets\.BACKUP_AGE_RECIPIENT \}\}/);
    expect(readFileSync(script, "utf8")).not.toMatch(/echo[^\n]*SUPABASE_DB_URL/);
  });
});

function isExpectedIncidentUpload(block: string): boolean {
  const steps = block.split("      - name: Upload release incident evidence\n");
  if (steps.length !== 2) return false;
  const upload = steps[1].split("\n      - name: ")[0];
  return (block.match(/uses: actions\/upload-artifact@/g) ?? []).length === 1 &&
    /^\s+uses: actions\/upload-artifact@/m.test(upload) &&
    (upload.match(/^\s+path:/gm) ?? []).length === 1 &&
    /^\s+name: priority-release-incident-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}$/m.test(upload) &&
    /^\s+path: \$\{\{ runner\.temp \}\}\/sunrise-priority-release-incident\.json$/m.test(upload) &&
    /^\s+retention-days: 3$/m.test(upload);
}
