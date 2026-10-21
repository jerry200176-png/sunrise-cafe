#!/usr/bin/env node
/**
 * CI gate: new/changed Supabase SQL must be additive-only (RULEBOOK F1).
 * Usage: node scripts/check-additive-sql.mjs [--base origin/main] [files...]
 * Env FOUNDER_APPROVED_SQL=true (set from PR label `founder-approved-sql`) downgrades
 * failure to a loud notice: only the Founder may apply that label (F1 decision).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { lintSql } from "./lib/sql-additive-lint.mjs";

const args = process.argv.slice(2);
const baseIdx = args.indexOf("--base");
const base = baseIdx >= 0 ? args.splice(baseIdx, 2)[1] : "origin/main";

function changedSqlFiles() {
  const names = execFileSync("git", ["diff", "--name-only", "--diff-filter=AM", `${base}...HEAD`], { encoding: "utf8" })
    .split("\n").filter(Boolean);
  const files = new Set(names.filter((f) => /^supabase\/.*\.sql$/.test(f)));
  // A changed runner or plan re-checks every SQL file the plan ties to a runner.
  if (names.some((f) => f === "scripts/production-migration-plan.json" || /^scripts\/apply-migration-.*\.mjs$/.test(f))) {
    const plan = JSON.parse(readFileSync("scripts/production-migration-plan.json", "utf8"));
    for (const e of plan.entries) {
      if (e.runner && names.includes(e.runner)) files.add(`supabase/${e.file}`);
    }
  }
  return [...files];
}

const files = (args.length ? args : changedSqlFiles()).filter((f) => existsSync(f));
let failed = 0;
for (const file of files) {
  const findings = lintSql(readFileSync(file, "utf8"));
  for (const f of findings) {
    failed++;
    console.log(`::error file=${file},line=${f.line}::non-additive SQL (${f.rule}): ${f.hint}`);
  }
}
console.log(`additive-sql: checked ${files.length} file(s), ${failed} finding(s)`);
if (failed && process.env.FOUNDER_APPROVED_SQL === "true") {
  console.log("::notice::label founder-approved-sql present: Founder decision (RULEBOOK F1) overrides the gate");
  process.exit(0);
}
process.exit(failed ? 1 : 0);
