#!/usr/bin/env node
/** Fails when any `uses:` in .github is not a full 40-hex commit SHA (local ./ actions and docker:// excluded). */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function unpinnedUses(source) {
  const bad = [];
  source.split("\n").forEach((line, i) => {
    const m = /^\s*-?\s*uses:\s*([^\s#]+)/.exec(line);
    if (!m) return;
    const ref = m[1];
    if (ref.startsWith("./") || ref.startsWith("docker://")) return;
    if (!/@[0-9a-f]{40}$/.test(ref)) bad.push({ line: i + 1, ref });
  });
  return bad;
}

function main() {
  const dir = ".github/workflows";
  let failed = 0;
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    for (const b of unpinnedUses(readFileSync(join(dir, f), "utf8"))) {
      failed++;
      console.log(`::error file=${dir}/${f},line=${b.line}::action not pinned to a full commit SHA: ${b.ref}`);
    }
  }
  console.log(`actions-pinned: ${failed ? "FAIL" : "ok"}`);
  process.exit(failed ? 1 : 0);
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) main();
