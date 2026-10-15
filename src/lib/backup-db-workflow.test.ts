import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Contract for .github/workflows/backup-db.yml (PR #459 review).
// The repo is PUBLIC: Actions logs and artifacts are world-readable, so the
// backup workflow must never leak the DB credential or upload plaintext.

const root = resolve(__dirname, "../..");
const workflow = readFileSync(resolve(root, ".github/workflows/backup-db.yml"), "utf8");
const isWindows = process.platform === "win32";

type Step = { name: string; text: string; run: string };

function parseSteps(src: string): Step[] {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => l === "    steps:");
  expect(start).toBeGreaterThan(-1);
  const steps: Step[] = [];
  let cur: string[] | null = null;
  const flush = () => {
    if (!cur) return;
    const text = cur.join("\n");
    const name = /^ {6}- name: (.*)$/.exec(cur[0])?.[1] ?? "";
    const runIdx = cur.findIndex((l) => l === "        run: |");
    let run = "";
    if (runIdx >= 0) {
      const body: string[] = [];
      for (const l of cur.slice(runIdx + 1)) {
        if (l.trim() !== "" && !l.startsWith("          ")) break;
        body.push(l.slice(10));
      }
      run = body.join("\n");
    } else {
      run = /^ {8}run: (.*)$/m.exec(text)?.[1] ?? "";
    }
    steps.push({ name, text, run });
  };
  for (const l of lines.slice(start + 1)) {
    if (/^ {6}- name: /.test(l)) {
      flush();
      cur = [l];
    } else if (cur) {
      cur.push(l);
    }
  }
  flush();
  return steps;
}

const steps = parseSteps(workflow);
const stepIndex = (pred: (s: Step) => boolean) => steps.findIndex(pred);
const touchesDb = (s: Step) =>
  /SUPABASE_DB_URL|pg_dump|psql|PGPASSFILE/.test(s.text) && !s.name.startsWith("Install");

describe("backup-db.yml contract", () => {
  it("has the main-ref guard and minimal permissions", () => {
    expect(workflow).toMatch(/^ {4}if: github\.ref == 'refs\/heads\/main'$/m);
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n\n/m);
    expect(workflow).not.toMatch(/pull_request/);
  });

  it("never checks out the repo, caches, or traces shell", () => {
    expect(workflow).not.toContain("actions/checkout");
    expect(workflow).not.toContain("actions/cache");
    expect(workflow).not.toMatch(/set -[a-z]*x/);
  });

  it("pins third-party actions to commit SHAs", () => {
    const uses = [...workflow.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
  });

  it("checks the age recipient before any DB access", () => {
    const recipientCheck = stepIndex((s) => s.name.startsWith("Fail closed without an age recipient"));
    const ageValidate = stepIndex((s) => s.name.startsWith("Validate the age recipient"));
    const firstDb = stepIndex(touchesDb);
    expect(recipientCheck).toBe(0);
    expect(ageValidate).toBeGreaterThan(recipientCheck);
    expect(firstDb).toBeGreaterThan(ageValidate);
  });

  it("only the prepare step sees the DB URL, and it is never on argv", () => {
    const withUrl = steps.filter((s) => s.text.includes("secrets.SUPABASE_DB_URL"));
    expect(withUrl.map((s) => s.name)).toEqual(["Prepare DB connection (masked, no URL on argv)"]);
    expect(workflow).not.toMatch(/(psql|pg_dump)"? [^\n]*SUPABASE_DB_URL/);
    expect(workflow).not.toMatch(/(psql|pg_dump)"? [^\n]*\$url/);
    expect(workflow).not.toMatch(/PGPASSWORD=/);
    const dump = steps.find((s) => s.name.startsWith("Dump"));
    expect(dump?.run).toMatch(/pgrun "\$PG_BIN\/pg_dump"/);
    expect(dump?.run).toMatch(/pgrun "\$PG_BIN\/psql"/);
  });

  it("always removes the passfile after the dump, even on failure", () => {
    const dump = stepIndex((s) => s.name.startsWith("Dump"));
    const rm = stepIndex((s) => s.name === "Remove DB credentials file");
    expect(rm).toBeGreaterThan(dump);
    expect(steps[rm].text).toMatch(/^ {8}if: always\(\)$/m);
    expect(steps[rm].run).toContain('rm -f "$RUNNER_TEMP/backup.pgpass"');
  });

  it("routes every psql/pg_dump call through pgrun (stderr redaction)", () => {
    for (const s of steps) {
      const lines = s.run.split("\n");
      for (const l of lines) {
        if (/\$PG_BIN\/(psql|pg_dump)\b/.test(l)) {
          expect(l, `${s.name}: ${l.trim()}`).toMatch(/pgrun "\$PG_BIN\/(psql|pg_dump)"/);
        }
      }
      for (const l of lines.filter((x) => !x.trim().startsWith("#"))) {
        // no bare psql/pg_dump invocation that bypasses pgrun
        expect(l, `${s.name}: ${l.trim()}`).not.toMatch(/(^|\$\(|[;|&]\s*)\s*(psql|pg_dump)\s/);
      }
    }
  });

  it("uploads only ciphertext, SHA256SUMS and manifest.json, kept >= 28 days", () => {
    const allow = stepIndex((s) => s.name.startsWith("Refuse to upload"));
    const upload = stepIndex((s) => s.text.includes("actions/upload-artifact@"));
    expect(allow).toBeGreaterThan(-1);
    expect(upload).toBe(allow + 1);
    expect(steps[allow].run).toContain(
      "! -name '*.age' ! -name 'SHA256SUMS' ! -name 'manifest.json'"
    );
    expect(steps[upload].text).toMatch(/^ {10}path: \$\{\{ runner\.temp \}\}\/backup-out\/$/m);
    expect(steps[upload].text).toMatch(/if-no-files-found: error/);
    const retention = Number(/retention-days: (\d+)/.exec(steps[upload].text)?.[1]);
    expect(retention).toBeGreaterThanOrEqual(28);
    expect(retention).toBeLessThanOrEqual(90);
  });
});

// ---------------------------------------------------------------------------
// Behaviour: the leak reproduced in review was libpq echoing a malformed URL
// (with the password) into the public log. Run the real step scripts.
// ---------------------------------------------------------------------------

const SECRET = "S3cretPW";
const prepare = steps.find((s) => s.name.startsWith("Prepare DB connection"))!.run;
const dumpRun = steps.find((s) => s.name.startsWith("Dump"))!.run;
const redactFn = /# >>> redact[^\n]*\n([\s\S]*?)# <<< redact/.exec(dumpRun)?.[1] ?? "";

const tmps: string[] = [];
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

function runPrepare(url: string | undefined) {
  const dir = mkdtempSync(join(tmpdir(), "backup-prep-"));
  tmps.push(dir);
  const envFile = join(dir, "github_env");
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    RUNNER_TEMP: dir,
    GITHUB_ENV: envFile,
  };
  if (url !== undefined) env.SUPABASE_DB_URL = url;
  const r = spawnSync("bash", ["-e", "-c", prepare], { env: env as unknown as NodeJS.ProcessEnv, encoding: "utf8" });
  const read = (p: string) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return "";
    }
  };
  return {
    status: r.status,
    out: `${r.stdout}${r.stderr}`,
    githubEnv: read(envFile),
    passfile: join(dir, "backup.pgpass"),
    passfileText: read(join(dir, "backup.pgpass")),
  };
}

// Lines GitHub would show in clear text (everything except mask commands).
const visible = (out: string) =>
  out
    .split("\n")
    .filter((l) => !l.startsWith("::add-mask::"))
    .join("\n");

describe.skipIf(isWindows)("backup-db.yml prepare step (no credential leak)", () => {
  const good = `postgresql://postgres.abcref:${SECRET}%40x@aws-0-ap.pooler.supabase.com:5432/postgres`;

  it("accepts a quoted paste, masks every part and writes a 0600 passfile", () => {
    const r = runPrepare(`  "${good}"\n`);
    expect(r.status).toBe(0);
    expect(visible(r.out)).not.toContain(SECRET);
    expect(visible(r.out)).not.toContain("pooler.supabase.com");
    expect(r.out).toContain(`::add-mask::${SECRET}%2540x`);
    expect(r.out).toContain(`::add-mask::${SECRET}@x`);
    expect(r.out).toContain("::add-mask::postgres.abcref");
    expect(r.out).toContain("::add-mask::aws-0-ap.pooler.supabase.com");
    expect(r.out).toContain(`::add-mask::${good.replace(/%/g, "%25")}`);
    expect(r.githubEnv).not.toContain(SECRET);
    expect(r.githubEnv).toContain("PGHOST=aws-0-ap.pooler.supabase.com");
    expect(r.githubEnv).toContain("PGUSER=postgres.abcref");
    expect(r.githubEnv).toContain("PGSSLMODE=require");
    expect(r.githubEnv).toMatch(/^PGPASSFILE=.*backup\.pgpass$/m);
    expect(r.passfileText).toBe(
      `aws-0-ap.pooler.supabase.com:5432:postgres:postgres.abcref:${SECRET}@x\n`
    );
    expect(statSync(r.passfile).mode & 0o777).toBe(0o600);
  });

  it("escapes ':' and '\\' in the passfile", () => {
    const r = runPrepare(`postgresql://u:a%3Ab%5Cc${SECRET}@h:6543/db`);
    expect(r.status).toBe(0);
    expect(r.passfileText).toBe(`h:6543:db:u:a\\:b\\\\c${SECRET}\n`);
  });

  it("escapes % and CR in mask values and skips a bare 'postgres' user", () => {
    const r = runPrepare(`postgresql://postgres:a%25b${SECRET}@db.example.test:5432/postgres`);
    expect(r.status).toBe(0);
    // encoded form a%25b... must be registered literally (runner unescapes %25)
    expect(r.out).toContain(`::add-mask::a%2525b${SECRET}`);
    // decoded form a%b...
    expect(r.out).toContain(`::add-mask::a%25b${SECRET}`);
    expect(r.out).not.toMatch(/^::add-mask::postgres$/m);
    expect(visible(r.out)).not.toContain(SECRET);
    for (const line of r.out.split("\n").filter((l) => l.startsWith("::add-mask::"))) {
      expect(line.slice("::add-mask::".length)).not.toMatch(/%(?!25|0D)/);
    }
  });

  it.each([
    ["missing", undefined, "DB_URL_MISSING"],
    ["placeholder", `postgresql://postgres:${SECRET}@db.[ref].supabase.co:5432/postgres`, "DB_URL_PLACEHOLDER"],
    ["bad percent-encoding (libpq would echo it)", `postgresql://postgres:${SECRET}%zz@h:5432/postgres`, "DB_URL_BAD_ENCODING"],
    ["no scheme separator", `postgresql//postgres:${SECRET}@h:5432/postgres`, "DB_URL_MALFORMED"],
    ["key=value form", `host=h user=postgres password=${SECRET}`, "DB_URL_MALFORMED"],
    ["encoded newline (env injection)", `postgresql://u%0AX=1:${SECRET}@h/db`, "DB_URL_BAD_ENCODING"],
  ])("fails closed with a fixed code and no visible secret: %s", (_label, url, code) => {
    const r = runPrepare(url);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(`::error::${code}`);
    expect(visible(r.out)).not.toContain(SECRET);
    expect(r.githubEnv).toBe("");
    expect(r.passfileText).toBe("");
  });
});

function redact(input: string, env: Record<string, string> = {}) {
  const r = spawnSync("bash", ["-c", `${redactFn}\nredact`], {
    input,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
  return r.stdout;
}

describe.skipIf(isWindows)("backup-db.yml stderr redaction", () => {
  it("is present in the dump step", () => {
    expect(redactFn).toContain("redact()");
  });

  it("redacts the libpq messages reproduced in review", () => {
    const leaks = [
      `psql: error: invalid connection option ""postgresql://postgres.abc:${SECRET}@aws-0-x.pooler.supabase.com:5432/postgres?sslmode"`,
      `psql: error: invalid percent-encoded token: "${SECRET}%zz"`,
      `pg_dump: error: connection to server failed: host=aws-0-x.pooler.supabase.com user=postgres.abc password=${SECRET}`,
    ];
    for (const leak of leaks) {
      const out = redact(`${leak}\n`);
      expect(out).not.toContain(SECRET);
      expect(out).not.toContain("pooler.supabase.com");
    }
  });

  it("replaces the connection host and user", () => {
    const out = redact(
      'connection to server at "aws-0-x.pooler.supabase.com" (1.2.3.4), port 5432 failed: FATAL:  password authentication failed for user "postgres.abc"\n',
      { PGHOST: "aws-0-x.pooler.supabase.com", PGUSER: "postgres.abc" }
    );
    expect(out).toContain("<host>");
    expect(out).toContain("<user>");
    expect(out).not.toContain("postgres.abc");
  });

  const hasPsql = !isWindows && spawnSync("psql", ["--version"]).status === 0;
  it.skipIf(!hasPsql)("real psql: passing the URL on argv leaks, the redacted path does not", () => {
    const cases = [
      // pasted with quotes -> "invalid connection option" echoes the whole URL
      `"postgresql://postgres.abc:${SECRET}@127.0.0.1:1/postgres?sslmode=require"`,
      // bad percent-encoding -> "invalid percent-encoded token" echoes the password
      `postgresql://postgres.abc:${SECRET}%zz@127.0.0.1:1/postgres`,
    ];
    for (const url of cases) {
      const old = spawnSync("psql", [url, "-c", "select 1"], {
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", PGCONNECT_TIMEOUT: "1" } as unknown as NodeJS.ProcessEnv,
      });
      expect(old.status).not.toBe(0);
      expect(old.stderr).toContain(SECRET); // the leak this workflow avoids
      expect(redact(old.stderr)).not.toContain(SECRET);
      // The new prepare step rejects or normalises the value before libpq sees it.
      const r = runPrepare(url);
      expect(visible(r.out)).not.toContain(SECRET);
    }
  });
});
