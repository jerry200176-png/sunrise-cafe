import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { createRequire } from "module";
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

// ---------------------------------------------------------------------------
// Source gate: identity + schema must be validated BEFORE any pg_dump.
// All URLs/refs below are synthetic; nothing connects anywhere.

const PROD_REF = "aaaabbbbccccddddeeee";
const STAGING_REF = "stagingrefstagingref";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const PROD_SHA = sha(PROD_REF);
const PW = "hunter2";
const urlFor = (ref: string) =>
  `postgresql://postgres:${PW}@db.${ref}.supabase.co:5432/postgres?sslmode=require`;
const poolerFor = (ref: string) =>
  `postgres://postgres.${ref}:${PW}@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`;

function expectNoSourceLeak(out: string) {
  expect(out).not.toContain(PW);
  expect(out).not.toContain(PROD_REF);
  expect(out).not.toContain(STAGING_REF);
  expect(out).not.toContain(PROD_SHA);
  expect(out).not.toContain("supabase.co");
  expect(out).not.toContain("pooler");
}

describe("scripts/db-drill/lib.sh source identity gate", () => {
  it("accepts the expected project via direct and pooler URLs, printing no URL/ref/hash", () =>
    withSandbox((dir) => {
      for (const url of [
        urlFor(PROD_REF),
        poolerFor(PROD_REF),
        ...["require", "verify-ca", "verify-full"].map(
          (mode) => `${poolerFor(PROD_REF)}?sslmode=${mode}`
        ),
        `${urlFor(PROD_REF)}&connect_timeout=10&application_name=drill@source/path`,
      ]) {
        const r = runLib(dir, `drill_assert_source_identity '${url}' '${PROD_SHA}'`);
        expect(r.status).toBe(0);
        expect(r.out.trim()).toBe("source identity: project ref matches expected sha256");
        expectNoSourceLeak(r.out);
      }
    }));

  it("fails closed on a staging-like / wrong project, missing expectation, or odd URL shapes", () =>
    withSandbox((dir) => {
      const cases: Array<[string, string, RegExp]> = [
        [urlFor(STAGING_REF), PROD_SHA, /identity mismatch/],
        [poolerFor(STAGING_REF), PROD_SHA, /identity mismatch/],
        [urlFor(PROD_REF), "", /missing or malformed/],
        [urlFor(PROD_REF), "not-a-hash", /missing or malformed/],
        [`postgresql://postgres:${PW}@db.example.com:5432/postgres`, PROD_SHA, /not a Supabase project host/],
        [`postgresql://postgres.${STAGING_REF}:${PW}@db.${PROD_REF}.supabase.co/postgres`, PROD_SHA, /different projects/],
        [`postgresql://postgres:${PW}@aws-0-x.pooler.supabase.com/postgres`, PROD_SHA, /cannot derive/],
        [`${urlFor(PROD_REF)}&hostaddr=10.0.0.1`, PROD_SHA, /disallowed parameter/],
        [`host=db.${PROD_REF}.supabase.co password=${PW}`, PROD_SHA, /not a postgres:\/\/ URL/],
      ];
      for (const [url, expected, msg] of cases) {
        const r = runLib(dir, `drill_assert_source_identity '${url}' '${expected}'`);
        expect(r.status).toBe(1);
        expect(r.out).toMatch(msg);
        expectNoSourceLeak(r.out);
      }
    }));

  it("refuses PGHOSTADDR / PGSERVICE redirection", () =>
    withSandbox((dir) => {
      const r = runLib(
        dir,
        `PGHOSTADDR=10.0.0.1 drill_assert_source_identity '${urlFor(PROD_REF)}' '${PROD_SHA}'`
      );
      expect(r.status).toBe(1);
      expect(r.out).toMatch(/overrides are not allowed/);
    }));
});

// Workflow-level fixture: run the real "Source" step script from the
// workflow with fake psql / pg_dump on PATH that record every invocation.

const ROOT = join(__dirname, "../..");
const yaml = createRequire(join(ROOT, "package.json"))("js-yaml") as {
  load(src: string): unknown;
};
const wf = yaml.load(
  readFileSync(join(ROOT, ".github/workflows/db-backup-restore-drill.yml"), "utf8")
) as {
  jobs: Record<
    string,
    {
      env: Record<string, string>;
      steps: Array<{ name?: string; run?: string; env?: Record<string, string> }>;
    }
  >;
};
const wfJob = Object.values(wf.jobs)[0];
const SOURCE_STEP = wfJob.steps.find((s) => s.name?.startsWith("Source"));
const SOURCE_RUN = SOURCE_STEP?.run ?? "";

type FakeDb = { tables: number; markers: number; tablesExtra?: string; markersExtra?: string };

function fakeDbTools(dir: string, db: FakeDb) {
  const bin = join(dir, "bin");
  const calls = join(dir, "calls.log");
  spawnSync("mkdir", ["-p", bin]);
  writeFileSync(
    join(bin, "psql"),
    `#!/usr/bin/env bash
echo "psql" >> "${calls}"
case "$*" in
  *tables_found*) printf '%s\\n' 'tables_found=${db.tables}' ${db.tablesExtra ? `'${db.tablesExtra}'` : ""} ;;
  *markers_found*) printf '%s\\n' 'markers_found=${db.markers}' ${db.markersExtra ? `'${db.markersExtra}'` : ""} ;;
  *counts.sql*) printf "order_items=4\norders=2\nreservations=3\nrooms=1\nschema_migrations=9\n" ;;
  *server_version*) echo "17.4" ;;
  *) exit 9 ;;
esac
`
  );
  writeFileSync(
    join(bin, "pg_dump"),
    `#!/usr/bin/env bash
echo "pg_dump" >> "${calls}"
for a in "$@"; do case "$a" in --file=*) echo dump > "\${a#--file=}" ;; esac; done
`
  );
  chmodSync(join(bin, "psql"), 0o755);
  chmodSync(join(bin, "pg_dump"), 0o755);
  return { bin, calls };
}

function runSourceStep(dir: string, url: string, expected: string, db: FakeDb) {
  const { bin, calls } = fakeDbTools(dir, db);
  const plain = join(dir, "plain");
  const r = spawnSync("bash", ["-c", SOURCE_RUN], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      HOME: dir,
      RUNNER_TEMP: join(dir, "rtemp"),
      PLAIN_DIR: plain,
      OUT_DIR: join(dir, "out"),
      DUMP_NAME: wfJob.env.DUMP_NAME,
      REQUIRED_TABLES: wfJob.env.REQUIRED_TABLES,
      IDENTITY_MARKERS: wfJob.env.IDENTITY_MARKERS,
      SUPABASE_DB_URL: url,
      EXPECTED_SOURCE_REF_SHA256: expected,
      PGSSLMODE: SOURCE_STEP?.env?.PGSSLMODE,
    },
  });
  const log = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : [];
  return {
    status: r.status,
    out: `${r.stdout}${r.stderr}`,
    calls: log.filter(Boolean),
    dumped: existsSync(join(plain, wfJob.env.DUMP_NAME)),
  };
}

describe("workflow Source step: wrong source fails before any dump", () => {
  const goodDb: FakeDb = { tables: 5, markers: 2 };

  it("positive control: the expected project with the Sunrise schema is dumped", () =>
    withSandbox((dir) => {
      const r = runSourceStep(dir, urlFor(PROD_REF), PROD_SHA, goodDb);
      expect(r.status).toBe(0);
      expect(r.calls).toContain("pg_dump");
      expect(r.dumped).toBe(true);
      // Gates (2 psql queries) come before the first count and the dump.
      expect(r.calls.indexOf("pg_dump")).toBeGreaterThanOrEqual(3);
      expectNoSourceLeak(r.out);
    }));

  it("staging-like source (same schema, different project ref): no psql, no pg_dump", () =>
    withSandbox((dir) => {
      const r = runSourceStep(dir, urlFor(STAGING_REF), PROD_SHA, goodDb);
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/identity mismatch/);
      expect(r.calls).toEqual([]);
      expect(r.dumped).toBe(false);
      expectNoSourceLeak(r.out);
    }));

  it.each([
    [
      "project host hidden after @ in query",
      `postgresql://postgres:${PW}@unrelated.invalid/postgres?application_name=@db.${PROD_REF}.supabase.co/x`,
    ],
    [
      "project host hidden after @ in path",
      `postgresql://postgres:${PW}@unrelated.invalid/postgres/@db.${PROD_REF}.supabase.co/x`,
    ],
    [
      "userinfo supplied only by query",
      `postgresql://unrelated.invalid/postgres?application_name=@db.${PROD_REF}.supabase.co/x`,
    ],
    [
      "multiple authority userinfo delimiters",
      `postgresql://postgres:${PW}@unrelated.invalid@db.${PROD_REF}.supabase.co/postgres`,
    ],
    ...["disable", "allow", "prefer", "", "require%00disable"].map((mode) => [
      `unsafe sslmode ${mode || "empty"}`,
      urlFor(PROD_REF).replace("sslmode=require", `sslmode=${mode}`),
    ]),
    ["duplicate sslmode downgrade", `${urlFor(PROD_REF)}&sslmode=disable`],
    ["duplicate sslmode encrypted", `${urlFor(PROD_REF)}&sslmode=verify-full`],
    ["encoded sslmode key", `${urlFor(PROD_REF)}&%73slmode=disable`],
    ["parameter without value separator", `${urlFor(PROD_REF)}&sslmode`],
    ["newline before downgrade", `${urlFor(PROD_REF)}\n&sslmode=disable`],
  ])("rejects %s before any psql or pg_dump call", (_name, url) =>
    withSandbox((dir) => {
      const r = runSourceStep(dir, url, PROD_SHA, goodDb);
      expect(r.status).toBe(1);
      expect(r.calls).toEqual([]);
      expect(r.dumped).toBe(false);
      expect(r.out).toMatch(/::error::source identity:/);
      expect(r.out).not.toContain(url);
      expect(r.out).not.toContain("unrelated.invalid");
      expectNoSourceLeak(r.out);
    }));

  it("missing expected identity variable: fails closed before connecting", () =>
    withSandbox((dir) => {
      const r = runSourceStep(dir, urlFor(PROD_REF), "", goodDb);
      expect(r.status).not.toBe(0);
      expect(r.calls).toEqual([]);
      expect(r.dumped).toBe(false);
    }));

  it.each(["tablesExtra", "markersExtra"] as const)(
    "rejects multiline %s without leaking unexpected output or dumping",
    (field) => withSandbox((dir) => {
      const extra = "SYNTHETIC_CUSTOMER_alice@example.invalid 王小明 0912-345-678";
      const r = runSourceStep(dir, urlFor(PROD_REF), PROD_SHA, { ...goodDb, [field]: extra });
      expect(r.status).toBe(1);
      expect(r.out).toContain("unexpected output shape");
      expect(r.out).not.toContain(extra);
      expectNoLeak(r.out);
      expectNoSourceLeak(r.out);
      expect(r.calls).not.toContain("pg_dump");
      expect(r.dumped).toBe(false);
    })
  );

  it("right project but missing Sunrise tables or markers: pg_dump never invoked", () =>
    withSandbox((dir) => {
      for (const db of [
        { tables: 3, markers: 2 },
        { tables: 5, markers: 1 },
      ]) {
        const r = runSourceStep(dir, urlFor(PROD_REF), PROD_SHA, db);
        expect(r.status).not.toBe(0);
        expect(r.out).toMatch(/refusing to continue/);
        expect(r.calls).not.toContain("pg_dump");
        expect(r.dumped).toBe(false);
        expectNoSourceLeak(r.out);
        rmSync(join(dir, "calls.log"), { force: true });
      }
    }));
});
