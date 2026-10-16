import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Shim-based test for scripts/restore-drill-cloud-backup.sh (PR #459 re-review):
// - Docker mode must compare EVERY table (docker exec -i used to swallow the loop's stdin).
// - LOCAL_DSN mode must refuse anything but an empty, loopback/socket, opted-in DB.

const root = resolve(__dirname, "../..");
const script = resolve(root, "scripts/restore-drill-cloud-backup.sh");
const isWindows = process.platform === "win32";

const tmps: string[] = [];
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

function writeExec(path: string, body: string) {
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path, 0o755);
}

function setup(actualCounts: Record<string, number>) {
  const dir = mkdtempSync(join(tmpdir(), "drill-shim-"));
  tmps.push(dir);
  const bin = join(dir, "bin");
  const art = join(dir, "artifact");
  mkdirSync(bin);
  mkdirSync(art);
  const log = join(dir, "log");
  writeFileSync(log, "");
  writeFileSync(
    join(dir, "counts.tsv"),
    Object.entries(actualCounts)
      .map(([t, n]) => `${t}\t${n}`)
      .join("\n") + "\n"
  );

  // docker CLI: `exec -i` forwards (and consumes) stdin, like the real client.
  writeExec(
    join(bin, "docker"),
    `cmd="$1"; shift
case "$cmd" in
  run) echo fake-container ;;
  rm) ;;
  exec)
    interactive=0
    while [[ "$1" == -* ]]; do [[ "$1" == -i ]] && interactive=1; shift; done
    shift
    if [ "$interactive" = 1 ]; then cat >/dev/null; fi
    prog="$1"; shift
    exec "${bin}/$prog" "$@" </dev/null ;;
esac`
  );
  writeExec(join(bin, "pg_isready"), "exit 0");
  writeExec(
    join(bin, "psql"),
    `echo "env PGHOST=\${PGHOST:-} PGSERVICE=\${PGSERVICE:-}" >> "${log}"
query=""
while [ $# -gt 0 ]; do
  if [ "$1" = "-c" ]; then query="$2"; shift; fi
  shift
done
if [ -z "$query" ]; then cat >/dev/null; exit 0; fi
case "$query" in
  *"pg_tables WHERE schemaname"*) echo "\${FAKE_EXISTING:-0}" ;;
  *pg_constraint*) echo 1 ;;
  *relrowsecurity*) echo t ;;
  *pg_policies*) echo 2 ;;
  *'FROM public."'*)
    t="\${query#*public.\\"}"; t="\${t%%\\"*}"
    echo "count $t" >> "${log}"
    awk -F'\\t' -v t="$t" '$1==t{print $2}' "${join(dir, "counts.tsv")}" ;;
esac`
  );
  writeExec(
    join(bin, "pg_restore"),
    `if [ "$1" = "--list" ]; then
  echo "1; 1 1 POLICY public a anon_read postgres"
  echo "2; 1 2 POLICY public b service_all postgres"
else
  cat >/dev/null
fi`
  );
  // age shim: "decrypt" = copy (artifact files are plaintext in this test).
  writeExec(
    join(bin, "age"),
    `out=""; in=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; -i) shift ;; -d) ;; *) in="$1" ;; esac
  shift
done
cp "$in" "$out"`
  );

  writeFileSync(join(art, "x.dump.age"), "dump");
  writeFileSync(join(art, "x.rowcounts.tsv.age"), "a\t1\nb\t2\nc\t3\n");
  writeFileSync(
    join(art, "x.meta.tsv.age"),
    "extension\tpgcrypto\textensions\nextension\tuuid-ossp\textensions\npublication\tsupabase_realtime\tpublic.a\n"
  );
  const sums = spawnSync("bash", ["-c", "sha256sum ./*.age > SHA256SUMS"], { cwd: art });
  expect(sums.status).toBe(0);
  writeFileSync(join(dir, "key"), "AGE-SECRET-KEY-TEST");

  const run = (env: Record<string, string> = {}) => {
    const r = spawnSync("bash", [script, art, join(dir, "key")], {
      encoding: "utf8",
      env: {
        PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        HOME: dir,
        DRILL_READY_SLEEP: "0",
        ...env,
      } as unknown as NodeJS.ProcessEnv,
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}`, log: readFileSync(log, "utf8") };
  };
  return { run };
}

const counted = (log: string) =>
  log
    .split("\n")
    .filter((l) => l.startsWith("count "))
    .map((l) => l.slice(6));

describe.skipIf(isWindows)("restore-drill-cloud-backup.sh (Docker mode)", () => {
  it("compares every table and passes when all counts match", () => {
    const r = setup({ a: 1, b: 2, c: 3 }).run();
    expect(r.out).toContain("tables checked: 3/3");
    expect(counted(r.log)).toEqual(["a", "b", "c"]);
    expect(r.out).toContain("ALTER PUBLICATION supabase_realtime ADD TABLE public.a;");
    expect(r.out).toContain("DRILL_RESULT=pass");
    expect(r.status).toBe(0);
  });

  it("fails when the LAST table's count is wrong", () => {
    const r = setup({ a: 1, b: 2, c: 99 }).run();
    expect(counted(r.log)).toEqual(["a", "b", "c"]);
    expect(r.out).toContain("FAIL: c backup=3 restored=99");
    expect(r.out).toContain("DRILL_RESULT=fail");
    expect(r.status).toBe(1);
  });

  it("fails when a table is missing from the restore", () => {
    const r = setup({ a: 1, b: 2 }).run();
    expect(r.out).toContain("FAIL: c backup=3 restored=");
    expect(r.status).toBe(1);
  });
});

describe.skipIf(isWindows)("restore-drill-cloud-backup.sh (LOCAL_DSN guards)", () => {
  const ok = { a: 1, b: 2, c: 3 };
  const optIn = { I_UNDERSTAND_THIS_DROPS_LOCAL_DATA: "1" };

  it("requires the explicit opt-in", () => {
    const r = setup(ok).run({ LOCAL_DSN: "postgresql://postgres@127.0.0.1:5432/drill" });
    expect(r.status).toBe(7);
    expect(r.out).toContain("I_UNDERSTAND_THIS_DROPS_LOCAL_DATA=1");
    expect(r.log).toBe("");
  });

  it.each([
    ["remote IP", "postgresql://postgres@10.0.0.5:5432/postgres"],
    ["remote name", "postgresql://postgres:pw@db.example.com/postgres"],
    ["service=", "postgresql:///postgres?service=prod"],
    ["hostaddr=", "postgresql://localhost/postgres?hostaddr=10.0.0.5"],
    ["remote host= param", "postgresql:///postgres?host=db.example.com"],
    ["key=value form", "host=127.0.0.1 dbname=drill"],
  ])("rejects a non-local target: %s", (_label, dsn) => {
    const r = setup(ok).run({ LOCAL_DSN: dsn, ...optIn });
    expect(r.status).toBe(7);
    expect(r.log).toBe("");
  });

  it("refuses when public already has tables", () => {
    const r = setup(ok).run({
      LOCAL_DSN: "postgresql://postgres@localhost/drill",
      FAKE_EXISTING: "5",
      ...optIn,
    });
    expect(r.status).toBe(7);
    expect(r.out).toContain("already has 5 table(s)");
    expect(counted(r.log)).toEqual([]);
  });

  it.each([
    ["127.0.0.1", "postgresql://postgres@127.0.0.1:55432/drill"],
    ["::1", "postgresql://postgres@[::1]:5432/drill"],
    ["unix socket", "postgresql://postgres@/drill?host=/tmp/pg&port=55432"],
  ])("runs against a loopback/socket target (%s) and ignores inherited PG* env", (_l, dsn) => {
    const r = setup(ok).run({
      LOCAL_DSN: dsn,
      PGHOST: "prod.example.com",
      PGSERVICE: "prod",
      ...optIn,
    });
    expect(r.out).toContain("DRILL_RESULT=pass");
    expect(r.status).toBe(0);
    expect(r.log).not.toContain("prod");
    expect(counted(r.log)).toEqual(["a", "b", "c"]);
  });
});
