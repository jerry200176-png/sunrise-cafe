import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const baselinePath = resolve(root, "docs/quality/typescript-baseline.txt");
const tscPath = resolve(root, "node_modules/typescript/bin/tsc");

if (!existsSync(baselinePath) || !existsSync(tscPath)) {
  console.error("TypeScript baseline or compiler is missing.");
  process.exit(1);
}

const result = spawnSync(process.execPath, [tscPath, "--noEmit", "--pretty", "false"], {
  cwd: root,
  encoding: "utf8",
});

const lines = `${result.stdout || ""}\n${result.stderr || ""}`
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => /\): error TS\d+: /.test(line));

const baseline = readFileSync(baselinePath, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const currentSet = new Set(lines);
const baselineSet = new Set(baseline);
const added = lines.filter((line) => !baselineSet.has(line));
const resolved = baseline.filter((line) => !currentSet.has(line));

console.log(`TypeScript baseline: current=${lines.length}, new=${added.length}, resolved=${resolved.length}`);
if (resolved.length > 0) {
  console.log("Resolved baseline errors:");
  resolved.forEach((line) => console.log(`- ${line}`));
}

if (added.length > 0) {
  console.error("New TypeScript errors detected:");
  added.forEach((line) => console.error(`- ${line}`));
  process.exit(1);
}

if (result.status !== 0 && lines.length === 0) {
  console.error("TypeScript compiler failed without parseable diagnostics.");
  process.exit(result.status || 1);
}
