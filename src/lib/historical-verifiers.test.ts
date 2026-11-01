import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, readdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { PINS, LEGACY_RUNNERS, HISTORICAL_ENTRIES, assertHistoricalVerifierPlan, assertVerifierFiles } from "../../scripts/lib/historical-verifiers.mjs";

const root = process.cwd();
const plan = JSON.parse(readFileSync(join(root, "scripts/production-migration-plan.json"), "utf8"));
const copy = () => structuredClone(plan);

describe("fixed read-only historical verifier contract", () => {
  it("accepts the actual plan and pinned files", () => {
    expect(() => assertHistoricalVerifierPlan(plan)).not.toThrow();
    expect(() => assertVerifierFiles(root)).not.toThrow();
  });

  it.each(HISTORICAL_ENTRIES.map((entry: { file: string }) => entry.file))(
    "rejects removed, rewritten or duplicated history for %s", (file: string) => {
      const removed = copy();
      removed.entries = removed.entries.filter((item: { file: string }) => item.file !== file);
      expect(() => assertHistoricalVerifierPlan(removed)).toThrow();
      const replaced = copy();
      const entry = replaced.entries.find((item: { file: string }) => item.file === file);
      entry.runner = "scripts/apply-migration-other.mjs";
      delete entry.verifier;
      expect(() => assertHistoricalVerifierPlan(replaced)).toThrow();
      const moved = copy();
      moved.entries.find((item: { file: string }) => item.file === file).phase = "invalid";
      expect(() => assertHistoricalVerifierPlan(moved)).toThrow();
      const duplicate = copy();
      duplicate.entries.push({ ...duplicate.entries.find((item: { file: string }) => item.file === file) });
      expect(() => assertHistoricalVerifierPlan(duplicate)).toThrow();
      const aliased = copy();
      aliased.entries.push({ file: `./${file}`, runner: "scripts/apply-migration-other.mjs", phase: "predeploy" });
      expect(() => assertHistoricalVerifierPlan(aliased)).toThrow();
    },
  );

  it("rejects unknown verifier names, misuse by unrelated entries, and reassignment", () => {
    for (const change of [
      (p: typeof plan) => { p.entries[0].verifier = "unknown"; },
      (p: typeof plan) => { p.entries[0].verifier = "market-parity"; },
      (p: typeof plan) => { p.entries.find((e: { verifier?: string }) => e.verifier === "bank-transfer").verifier = "line-pay"; },
    ]) {
      const mutated = copy(); change(mutated);
      expect(() => assertHistoricalVerifierPlan(mutated)).toThrow();
    }
  });

  it("fails closed on restored legacy runner, changed verifier/dependency/SQL or symlink", () => {
    const temp = mkdtempSync(join(tmpdir(), "sunrise-verifier-test-"));
    try {
      for (const file of Object.keys(PINS)) {
        mkdirSync(dirname(join(temp, file)), { recursive: true });
        copyFileSync(join(root, file), join(temp, file));
      }
      expect(() => assertVerifierFiles(temp)).not.toThrow();
      for (const file of LEGACY_RUNNERS) {
        writeFileSync(join(temp, file), "unexpected writer");
        expect(() => assertVerifierFiles(temp)).toThrow(/writable runner/);
        rmSync(join(temp, file));
      }
      for (const file of ["scripts/verify-market-parity.mjs", "scripts/lib/rest-schema-probe.mjs", "supabase/migration-bank-transfer-reports.sql"]) {
        writeFileSync(join(temp, file), "changed");
        expect(() => assertVerifierFiles(temp)).toThrow(/hash mismatch/);
        copyFileSync(join(root, file), join(temp, file));
      }
      const path = join(temp, "scripts/verify-market-parity.mjs");
      rmSync(path);
      symlinkSync(join(root, "scripts/verify-market-parity.mjs"), path);
      expect(() => assertVerifierFiles(temp)).toThrow(/regular verifier file/);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });

  it("rejects old runner references and obvious direct SQL application across all workflows", () => {
    const oldPaths = LEGACY_RUNNERS as string[];
    const oldSql = HISTORICAL_ENTRIES.map((entry: { file: string }) => entry.file);
    const forbidden = (source: string) => source.split("\n").some((line) =>
      oldPaths.some((old) => line.includes(old)) ||
      (oldSql.some((sql: string) => line.includes(sql)) && /\b(?:psql|supabase\s+db|apply-migration)\b/i.test(line))
    );
    for (const name of readdirSync(join(root, ".github/workflows"))) {
      if (!/\.ya?ml$/.test(name)) continue;
      expect(forbidden(readFileSync(join(root, ".github/workflows", name), "utf8")), name).toBe(false);
    }
    expect(forbidden(`run: node ${oldPaths[0]}`)).toBe(true);
    expect(forbidden(`run: psql --file=supabase/${oldSql[0]}`)).toBe(true);
    expect(forbidden(`run: cat supabase/${oldSql[0]} | psql`)).toBe(true);
  });

  it("runs the separate market command only through pinned GET probes and fails on uncertain responses", () => {
    const run = (status: number, id = "market-parity") => spawnSync(process.execPath,
      ["scripts/run-production-migration-phase.mjs", "--verify", id], {
        cwd: root, encoding: "utf8", timeout: 10000,
        env: {
          NODE_ENV: "test",
          NODE_OPTIONS: `--no-warnings --experimental-loader=${join(root, "scripts/test-fixtures/deny-db-loader.mjs")} --import=${join(root, "scripts/test-fixtures/mock-rest-preload.mjs")}`,
          SYNTHETIC_SCENARIO: JSON.stringify({ default: { status, body: status === 200 ? "[]" : "{}" } }),
          NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "synthetic-key-".repeat(5),
        },
      });
    const ok = run(200);
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain('"verifier":"market-parity"');
    expect(ok.stderr).not.toContain("UNEXPECTED_DB_IMPORT");
    const failure = run(503);
    expect(failure.status).toBe(1);
    expect(failure.stdout).not.toContain('"status":"complete"');
    expect(failure.stderr).not.toMatch(/UNEXPECTED_DB_IMPORT|synthetic-key/);
    const unknown = run(200, "unregistered");
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain("Unknown historical verifier");
  });

  it("keeps the separate market workflow on the registry verifier", () => {
    const text = readFileSync(join(root, ".github/workflows/apply-migration-market-parity.yml"), "utf8");
    expect(text).toContain("node scripts/run-production-migration-phase.mjs --verify market-parity");
    expect(text).not.toMatch(/node scripts\/(?:apply-migration|verify-market-parity)/);
    expect(text).not.toMatch(/SUPABASE_DB_URL|vercel-production-env|postgres|psql/i);
    const deploy = readFileSync(join(root, ".github/workflows/production-deploy-migrate.yml"), "utf8");
    expect(deploy.match(/node scripts\/run-production-migration-phase\.mjs predeploy/g)).toHaveLength(2);
    expect(deploy.match(/node scripts\/run-production-migration-phase\.mjs postdeploy/g)).toHaveLength(2);
    for (const legacy of LEGACY_RUNNERS) expect(deploy).not.toContain(legacy);
  });
});
