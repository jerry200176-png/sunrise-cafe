import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Executable log-safety test for scripts/db-drill/lib.sh: tool output that
// looks like personal data / connection details must never reach the
// caller's stdout or stderr (= the Actions log), while failure status and a
// sanitized stage / exit / SQLSTATE class line are kept.

const LIB = join(__dirname, "../../scripts/db-drill/lib.sh");

const SENSITIVE = [
  "王小明",
  "0912-345-678",
  "Alice Example",
  "alice@example.com",
  "db.secretref.supabase.co",
  "postgresql://postgres:hunter2@",
  "COPY reservations",
  "INSERT INTO orders",
];

const FAKE_STDERR = [
  'psql: error: connection to server at "db.secretref.supabase.co" failed: postgresql://postgres:hunter2@',
  "ERROR:  23505",
  "DETAIL:  Key (phone)=(0912-345-678) already exists. 王小明 Alice Example alice@example.com",
  "CONTEXT:  COPY reservations, line 3: \"王小明\t0912-345-678\"",
  "STATEMENT:  INSERT INTO orders VALUES ('Alice Example')",
].join("\n");

function withSandbox<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "db-drill-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Puts fake psql / pg_restore on PATH that print sensitive content. */
function fakeTools(dir: string, exitCode: number, stderr = FAKE_STDERR) {
  const bin = join(dir, "bin");
  spawnSync("mkdir", ["-p", bin]);
  writeFileSync(join(dir, "stderr.txt"), stderr);
  for (const tool of ["psql", "pg_restore", "pg_dump"]) {
    const p = join(bin, tool);
    writeFileSync(
      p,
      `#!/usr/bin/env bash\necho "row: 王小明 0912-345-678 alice@example.com"\ncat "${join(dir, "stderr.txt")}" >&2\nexit ${exitCode}\n`
    );
    chmodSync(p, 0o755);
  }
  return bin;
}

function runLib(dir: string, script: string, bin?: string) {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    PATH: `${bin ? `${bin}:` : ""}${process.env.PATH ?? ""}`,
    RUNNER_TEMP: join(dir, "rtemp"),
    HOME: dir,
  };
  const r = spawnSync("bash", ["-c", `set -euo pipefail\n. "${LIB}"\n${script}`], {
    env,
    encoding: "utf8",
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function expectNoLeak(out: string) {
  for (const s of SENSITIVE) expect(out).not.toContain(s);
  expect(out).not.toMatch(/row:|DETAIL|CONTEXT|STATEMENT|hunter2/);
}

describe("scripts/db-drill/lib.sh log safety", () => {
  it("drill_quiet: failure keeps status, prints only stage/exit/class, leaks nothing", () =>
    withSandbox((dir) => {
      const bin = fakeTools(dir, 3);
      const r = runLib(dir, 'drill_quiet restore-pg-restore - pg_restore --dbname=drill x.dump', bin);
      expect(r.status).toBe(3);
      expectNoLeak(r.out);
      expect(r.out.trim()).toBe(
        "::error::drill stage 'restore-pg-restore' failed (exit=3, sqlstate_class=23)"
      );
      // Diagnostics stay in mode-600 files under $RUNNER_TEMP/drill-logs.
      const err = join(dir, "rtemp/drill-logs/restore-pg-restore.err");
      expect(readFileSync(err, "utf8")).toContain("0912-345-678");
      expect(statSync(err).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, "rtemp/drill-logs")).mode & 0o777).toBe(0o700);
    }));

  it("drill_quiet: success with noisy stderr prints nothing", () =>
    withSandbox((dir) => {
      const bin = fakeTools(dir, 0);
      const r = runLib(dir, "drill_quiet source-pg-dump - pg_dump --file=x.dump", bin);
      expect(r.status).toBe(0);
      expect(r.out).toBe("");
    }));

  it("drill_quiet: aborts a set -e caller (failure is not suppressed)", () =>
    withSandbox((dir) => {
      const bin = fakeTools(dir, 2);
      const r = runLib(dir, "drill_quiet source-version - psql -c x\necho SHOULD-NOT-RUN", bin);
      expect(r.status).toBe(2);
      expect(r.out).not.toContain("SHOULD-NOT-RUN");
      expectNoLeak(r.out);
    }));

  it("sanitizer: unknown / non-allowlisted SQLSTATE and free text map to 'unknown'", () =>
    withSandbox((dir) => {
      const cases: Array<[string, string]> = [
        ["ERROR:  duplicate key value 王小明", "unknown"],
        ["ERROR:  ALICE something", "unknown"],
        ["FATAL:  28P01", "28"],
        ["pg_restore: error: could not execute query: ERROR:  42P01: x", "42"],
        ["nothing here 0912-345-678", "unknown"],
      ];
      for (const [content, cls] of cases) {
        const f = join(dir, "e.txt");
        writeFileSync(f, content);
        const r = runLib(dir, `drill_sqlstate_class "${f}"`);
        expect(r.out).toBe(cls);
      }
    }));

  it("drill_quiet rejects stage names that could smuggle text", () =>
    withSandbox((dir) => {
      const r = runLib(dir, 'drill_quiet "x 王小明" - true');
      expect(r.status).toBe(64);
      expect(r.out).not.toContain("王小明");
    }));

  it("drill_counts: refuses (without echoing) output that is not table=count", () =>
    withSandbox((dir) => {
      const bin = join(dir, "bin");
      spawnSync("mkdir", ["-p", bin]);
      writeFileSync(
        join(bin, "psql"),
        '#!/usr/bin/env bash\necho "reservations=3"\necho "王小明|0912-345-678"\n'
      );
      chmodSync(join(bin, "psql"), 0o755);
      const r = runLib(dir, `drill_counts restore-counts "${join(dir, "c.counts")}"`, bin);
      expect(r.status).toBe(1);
      expectNoLeak(r.out);
      expect(r.out).toContain("unexpected output shape");
    }));

  it("drill_counts + drill_require_tables: pass on well-formed output, fail closed on missing table", () =>
    withSandbox((dir) => {
      const bin = join(dir, "bin");
      spawnSync("mkdir", ["-p", bin]);
      writeFileSync(
        join(bin, "psql"),
        '#!/usr/bin/env bash\nprintf "rooms=2\\nreservations=5\\norders=1\\n"\n'
      );
      chmodSync(join(bin, "psql"), 0o755);
      const counts = join(dir, "c.counts");
      const ok = runLib(
        dir,
        `drill_counts source-counts "${counts}" "postgresql://postgres:hunter2@db.secretref.supabase.co/x"\ndrill_require_tables "${counts}" reservations rooms orders`,
        bin
      );
      expect(ok.status).toBe(0);
      expect(ok.out.trim()).toBe("source-counts: counted 3 tables");
      expect(readFileSync(counts, "utf8")).toBe("orders=1\nreservations=5\nrooms=2\n");
      const missing = runLib(dir, `drill_require_tables "${counts}" reservations order_items`, bin);
      expect(missing.status).toBe(1);
      expect(missing.out.trim()).toBe("::error::required Sunrise table missing: order_items");
    }));

  it("drill_identity: validates markers and never echoes the connection string", () =>
    withSandbox((dir) => {
      const bin = join(dir, "bin");
      spawnSync("mkdir", ["-p", bin]);
      writeFileSync(join(bin, "psql"), '#!/usr/bin/env bash\necho "markers_found=2"\n');
      chmodSync(join(bin, "psql"), 0o755);
      const out = join(dir, "id.txt");
      const ok = runLib(
        dir,
        `drill_identity source-identity "${out}" "20260710-reservations-no-overlap,20260711-job-runs" "postgresql://postgres:hunter2@db.secretref.supabase.co/x"`,
        bin
      );
      expect(ok.status).toBe(0);
      expect(ok.out).toBe("");
      expect(readFileSync(out, "utf8").trim()).toBe("markers_found=2");
      const bad = runLib(dir, `drill_identity s "${out}" "x'); DROP TABLE y; --"`, bin);
      expect(bad.status).toBe(64);
      expect(bad.out).not.toContain("DROP");
    }));
});
