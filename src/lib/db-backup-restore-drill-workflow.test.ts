import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { createRequire } from "module";
import { join } from "path";

// Static safety contract for the cloud backup + isolated restore drill
// (CG-011). The workflow touches the production database, so these
// assertions guard its trigger surface, isolation and artifact scope.

const ROOT = join(__dirname, "../..");
const WORKFLOW = ".github/workflows/db-backup-restore-drill.yml";
const yaml = createRequire(join(ROOT, "package.json"))("js-yaml") as {
  load(src: string): unknown;
};

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  if?: string;
};

const raw = readFileSync(join(ROOT, WORKFLOW), "utf8");
// js-yaml (YAML 1.2) keeps `on` as a string key.
const wf = yaml.load(raw) as {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: Record<
    string,
    {
      if?: string;
      "timeout-minutes"?: number;
      container?: { image: string } | string;
      services?: Record<string, Record<string, unknown>>;
      steps: Step[];
    }
  >;
};
const jobs = Object.values(wf.jobs);
const job = jobs[0];
const steps = job.steps;

describe("db-backup-restore-drill workflow (static)", () => {
  it("is dispatch-only with a validated age_recipient input", () => {
    expect(Object.keys(wf.on)).toEqual(["workflow_dispatch"]);
    expect(raw).not.toMatch(/^\s*(pull_request|pull_request_target|push|schedule|workflow_run):/m);
    const inputs = (wf.on.workflow_dispatch as { inputs: Record<string, { required: boolean }> })
      .inputs;
    expect(Object.keys(inputs)).toEqual(["age_recipient"]);
    expect(inputs.age_recipient.required).toBe(true);
    expect(raw).toContain("^age1[0-9a-z]{58}$");
    // The input is only read through env, never interpolated into a script.
    for (const s of steps) {
      expect(s.run ?? "").not.toContain("${{ inputs.");
    }
  });

  it("runs only on main with read-only token, serialized, bounded", () => {
    expect(jobs).toHaveLength(1);
    expect(job.if).toBe("github.ref == 'refs/heads/main'");
    expect(wf.permissions).toEqual({ contents: "read" });
    expect(wf.concurrency).toEqual({ group: "sunrise-db-backup", "cancel-in-progress": false });
    expect(job["timeout-minutes"]).toBe(30);
  });

  it("uses postgres:17 tooling and asserts pg_dump major >= 17", () => {
    const image = typeof job.container === "string" ? job.container : job.container?.image;
    expect(image).toBe("postgres:17");
    expect(raw).toMatch(/major < 17/);
  });

  it("restore target is a service with no published ports", () => {
    const services = job.services ?? {};
    expect(Object.keys(services)).toEqual(["restore-db"]);
    const svc = services["restore-db"];
    expect(svc.image).toBe("postgres:17");
    expect(svc).not.toHaveProperty("ports");
    expect(raw).not.toMatch(/^\s*ports:/m);
  });

  it("passes SUPABASE_DB_URL only via env to the source steps and never echoes it", () => {
    const withSecret = steps.filter((s) => JSON.stringify(s).includes("secrets."));
    expect(withSecret.map((s) => s.name)).toEqual([
      "Validate inputs and secret presence",
      "Source — identity, read-only counts, pg_dump, read-only counts",
    ]);
    for (const s of withSecret) {
      expect(s.env?.SUPABASE_DB_URL).toBe("${{ secrets.SUPABASE_DB_URL }}");
      expect(s.run ?? "").not.toContain("${{ secrets.");
    }
    for (const s of steps) {
      const run = s.run ?? "";
      expect(run).not.toMatch(/(echo|printf)[^\n]*\$\{?(SUPABASE_DB_URL|DB_URL)\b/);
      expect(run).not.toMatch(/set -x|set -o xtrace/);
      if (run) expect(run).toMatch(/set -e?uo pipefail/);
    }
    const source = withSecret[1];
    expect(source.env?.PGOPTIONS).toBe("-c default_transaction_read_only=on");
    expect(source.run).toContain("--format=custom");
    expect(source.run).toContain("--no-owner");
    expect(source.run).toContain("--schema=public");
  });

  it("restores with exit-on-error into restore-db only and requires matching counts", () => {
    const restore = steps.find((s) => s.name === "Restore drill into isolated service DB");
    expect(restore?.env?.PGHOST).toBe("restore-db");
    expect(JSON.stringify(restore)).not.toContain("secrets.");
    expect(restore?.run).toContain("--exit-on-error");
    expect(restore?.run).toContain("--no-owner");
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(restore?.run).toContain(`CREATE ROLE ${role} `);
    }
    expect(restore?.run).toContain(
      "CREATE ROLE backup_ro NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;"
    );
    expect(restore?.run).toContain("drill_quiet restore-prepare");
    expect(restore?.run).toContain('cmp -s "${PLAIN_DIR}/source.counts" "${PLAIN_DIR}/restore.counts"');
    expect(restore?.run).toContain('cmp -s "${PLAIN_DIR}/source.identity" "${PLAIN_DIR}/restore.identity"');
  });

  it("uses only a fixed unprivileged ACL stub and never exports source role names", () => {
    const restore = steps.find((s) => s.name === "Restore drill into isolated service DB");
    const manifest = steps.find((s) => s.name?.startsWith("Bundle + encrypt"));
    const summary = steps.find((s) => s.name?.startsWith("Step summary"));
    expect(restore?.run).not.toMatch(/pg_roles|pg_auth_members|role_table_grants|pg_get_userbyid/);
    expect(restore?.run?.match(/CREATE ROLE backup_ro\b/g)).toHaveLength(1);
    expect(restore?.run).not.toContain("CREATE ROLE backup_ro LOGIN");
    expect(manifest?.run).not.toMatch(/backup_ro|pg_roles|pg_auth_members|pg_get_userbyid/);
    expect(summary?.run).not.toMatch(/backup_ro|pg_roles|pg_auth_members|pg_get_userbyid/);
    expect(manifest?.run).toContain('age --encrypt --recipient "${AGE_RECIPIENT}"');
  });

  it("never prints dump contents", () => {
    for (const s of steps) {
      expect(s.run ?? "").not.toMatch(/cat [^\n]*\.dump|pg_restore [^\n]*(-f -|--file=-)/);
    }
  });

  it("uploads only the encrypted dump, its checksum and the manifest (SHA-pinned)", () => {
    const uploads = steps.filter((s) => s.uses?.startsWith("actions/upload-artifact"));
    expect(uploads).toHaveLength(1);
    const up = uploads[0];
    expect(up.uses).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}$/);
    const paths = String(up.with?.path)
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    expect(paths).toEqual([
      "drill-out/sunrise-public-bundle.tar.age",
      "drill-out/sunrise-public-bundle.tar.age.sha256",
      "drill-out/manifest.json",
    ]);
    expect(up.with?.["retention-days"]).toBe(14);
    for (const s of steps.filter((x) => x.uses)) {
      expect(s.uses).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it("encrypts the dump + per-table counts as one bundle and cleans up on failure", () => {
    const enc = steps.find((s) => s.name?.startsWith("Bundle + encrypt"));
    expect(enc?.run).toContain('age --encrypt --recipient "${AGE_RECIPIENT}"');
    expect(enc?.run).toMatch(/tar -C "\$\{PLAIN_DIR\}" -cf [^\n]*\\\n\s+"\$\{DUMP_NAME\}" source\.counts restore\.counts/);
    expect(enc?.run).toContain('shred -u "${PLAIN_DIR}/${DUMP_NAME}" "${PLAIN_DIR}/${BUNDLE_NAME}"');
    const cleanup = steps[steps.length - 1];
    expect(cleanup.if).toBe("always()");
    expect(cleanup.run).toContain("shred -u");
    expect(cleanup.run).toContain("/drill-logs");
  });

  it("routes every psql / pg_dump / pg_restore call through drill_quiet", () => {
    // A tool in command position (line start, after $( ; && || |) would write
    // straight to the Actions log. Only `--version` probes are allowed.
    const direct = /(^\s*|\$\(\s*|;\s*|&&\s*|\|\|\s*|\|\s*)(psql|pg_dump|pg_restore)\s/;
    const wrapped = /^\s*drill_quiet [a-z0-9_-]+ \S+\s+(psql|pg_dump|pg_restore) /;
    let wrappedCount = 0;
    for (const s of steps) {
      if (!s.run) continue;
      const logical = s.run.replace(/\\\n\s*/g, " ").split("\n");
      for (const line of logical) {
        if (wrapped.test(line)) wrappedCount += 1;
        if (/(pg_dump|psql) --version/.test(line)) continue;
        expect(line).not.toMatch(direct);
      }
    }
    // source-version, source-pg-dump, restore-prepare, restore-toc, restore-pg-restore
    expect(wrappedCount).toBeGreaterThanOrEqual(5);
    expect(raw).toContain(". scripts/db-drill/lib.sh");
  });

  it("validates source identity and schema BEFORE pg_dump; restore re-checked after", () => {
    const env = (job as unknown as { env: Record<string, string> }).env;
    expect(env.REQUIRED_TABLES.split(" ")).toEqual([
      "reservations",
      "orders",
      "order_items",
      "rooms",
      "schema_migrations",
    ]);
    expect(env.IDENTITY_MARKERS).toMatch(/^\d{8}-[a-z0-9-]+(,\d{8}-[a-z0-9-]+)*$/);
    const validate = steps.find((s) => s.name === "Validate inputs and secret presence");
    const source = steps.find((s) => s.name?.startsWith("Source"));
    const restore = steps.find((s) => s.name === "Restore drill into isolated service DB");
    // Expected identity is a non-secret repo variable, required up front.
    for (const st of [validate, source]) {
      expect(st?.env?.EXPECTED_SOURCE_REF_SHA256).toBe(
        "${{ vars.SUNRISE_SOURCE_PROJECT_REF_SHA256 }}"
      );
    }
    expect(validate?.run).toContain('"${EXPECTED_SOURCE_REF_SHA256:-}" =~ ^[0-9a-f]{64}$');
    const run = source?.run ?? "";
    const idGate = run.indexOf('drill_assert_source_identity "${SUPABASE_DB_URL}" "${EXPECTED_SOURCE_REF_SHA256}"');
    const schemaGate = run.indexOf('drill_schema_preflight source-preflight "${REQUIRED_TABLES}" "${IDENTITY_MARKERS}"');
    const firstPsql = run.indexOf("drill_counts source-counts-before");
    const dump = run.indexOf("pg_dump --dbname=");
    expect(idGate).toBeGreaterThan(-1);
    expect(schemaGate).toBeGreaterThan(idGate);
    expect(firstPsql).toBeGreaterThan(schemaGate);
    expect(dump).toBeGreaterThan(firstPsql);
    expect(run).toMatch(/drill_require_tables "\$\{PLAIN_DIR\}\/source\.counts" \$\{REQUIRED_TABLES\}/);
    expect(restore?.run).toMatch(/drill_require_tables "\$\{PLAIN_DIR\}\/restore\.counts" \$\{REQUIRED_TABLES\}/);
    expect(restore?.run).toContain("drill_identity restore-identity ");
  });

  it("public manifest and summary carry totals/checksums only, and state public-schema scope", () => {
    const enc = steps.find((s) => s.name?.startsWith("Bundle + encrypt"));
    expect(enc?.run).toContain("PUBLIC SCHEMA ONLY - not a full Supabase recovery");
    expect(enc?.run).not.toMatch(/tables:\s*\$tables/);
    expect(enc?.run).toContain("total_rows: $total_rows");
    const summary = steps.find((s) => s.name?.startsWith("Step summary"));
    expect(summary?.run).not.toContain(".tables");
    expect(summary?.run).toContain('["drill_result","identity_check","dump_sha256","bundle_sha256","age_sha256","table_count","total_rows"]');
  });

  it("does not reuse the known-defective local backup scripts", () => {
    for (const s of steps) {
      expect(s.run ?? "").not.toMatch(/backup-db\.sh|restore-drill\.sh/);
    }
  });
});
