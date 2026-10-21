#!/usr/bin/env node
/**
 * Blocking npm audit gate (Gap #8): fails on high/critical advisories unless the
 * advisory is in .github/audit-allowlist.json (id, reason, expires). Expired
 * entries fail again so false positives cannot rot silently.
 * Usage: node scripts/npm-audit-gate.mjs [--json audit.json]   (default: runs `npm audit --json`)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BLOCKING = new Set(["high", "critical"]);
const ghsaOf = (url = "") => /GHSA-[a-z0-9-]+/i.exec(url)?.[0] ?? url;

export function evaluateAudit(audit, allowlist, now = new Date()) {
  if (!audit || audit.error || !audit.vulnerabilities) {
    return { ok: false, problems: [`npm audit did not return a report (${audit?.error?.summary ?? "no data"}); failing closed`], allowed: [] };
  }
  const allow = new Map((allowlist ?? []).map((e) => [e.id, e]));
  const problems = [];
  const allowed = [];
  const roots = new Map();
  for (const [name, v] of Object.entries(audit.vulnerabilities)) {
    for (const via of v.via ?? []) {
      if (typeof via === "object" && BLOCKING.has(via.severity)) roots.set(ghsaOf(via.url), { name: via.name ?? name, severity: via.severity, title: via.title });
    }
    // A blocking package with no advisory object anywhere upstream is reported by package name.
    if (BLOCKING.has(v.severity) && !(v.via ?? []).length) roots.set(`pkg:${name}`, { name, severity: v.severity, title: "no advisory detail" });
  }
  for (const [id, info] of roots) {
    const entry = allow.get(id);
    if (!entry) problems.push(`${info.severity} ${info.name} ${id}: ${info.title}`);
    else if (!entry.reason || !entry.expires) problems.push(`${id}: allowlist entry needs reason and expires`);
    else if (new Date(entry.expires) < now) problems.push(`${id}: allowlist entry expired ${entry.expires} (${info.name})`);
    else allowed.push(id);
  }
  return { ok: problems.length === 0, problems, allowed };
}

function main() {
  const jsonIdx = process.argv.indexOf("--json");
  const raw = jsonIdx > 0
    ? readFileSync(process.argv[jsonIdx + 1], "utf8")
    : (() => { try { return execFileSync("npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 64 << 20 }); } catch (e) { return e.stdout ?? "{}"; } })();
  const allowlist = JSON.parse(readFileSync(new URL("../.github/audit-allowlist.json", import.meta.url), "utf8"));
  const r = evaluateAudit(JSON.parse(raw), allowlist);
  for (const id of r.allowed) console.log(`::notice::npm audit: ${id} allowlisted`);
  for (const p of r.problems) console.log(`::error::npm audit: ${p}`);
  console.log(`npm audit gate: ${r.ok ? "pass" : "FAIL"} (${r.allowed.length} allowlisted)`);
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) main();
