import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";

// Exercise the real unchanged CLI against disposable Git histories, including
// its runner-to-SQL selection, rather than merely matching its source text.
describe("additive diff gate integration", () => {
  it.each(["new SQL", "changed writable runner"])('rejects %s that reaches non-additive SQL', (scenario) => {
    const temp = mkdtempSync(join(tmpdir(), "sunrise-sql-gate-"));
    const run = (args: string[]) => {
      const result = spawnSync(args[0], args.slice(1), { cwd: temp, encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.invalid" } });
      return result;
    };
    try {
      mkdirSync(join(temp, "scripts/lib"), { recursive: true });
      mkdirSync(join(temp, "supabase"), { recursive: true });
      for (const file of ["scripts/check-additive-sql.mjs", "scripts/lib/sql-additive-lint.mjs"]) copyFileSync(join(process.cwd(), file), join(temp, file));
      writeFileSync(join(temp, "scripts/production-migration-plan.json"), JSON.stringify({ entries: [{ file: "migration-old.sql", runner: "scripts/apply-migration-old.mjs", phase: "postdeploy", sql_class: "grandfathered" }] }));
      writeFileSync(join(temp, "scripts/apply-migration-old.mjs"), "// old runner\n");
      writeFileSync(join(temp, "supabase/migration-old.sql"), "DROP TABLE t;\n");
      expect(run(["git", "init", "-q"]).status).toBe(0);
      expect(run(["git", "add", "."]).status).toBe(0);
      expect(run(["git", "commit", "-qm", "base"]).status).toBe(0);
      if (scenario === "new SQL") writeFileSync(join(temp, "supabase/migration-new.sql"), "DROP TABLE t;\n");
      else writeFileSync(join(temp, "scripts/apply-migration-old.mjs"), "// changed runner\n");
      expect(run(["git", "add", "."]).status).toBe(0);
      expect(run(["git", "commit", "-qm", "change"]).status).toBe(0);
      const result = run([process.execPath, "scripts/check-additive-sql.mjs", "--base", "HEAD^"]);
      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(/non-additive SQL \(drop\)/);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
});
