import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateAudit } from "../../scripts/npm-audit-gate.mjs";
import { unpinnedUses } from "../../scripts/check-actions-pinned.mjs";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const adv = (url: string, severity = "high") => ({ vulnerabilities: { pkg: { severity, via: [{ url, severity, name: "pkg", title: "t" }] } } });
const allow = [{ id: "GHSA-aaaa-bbbb-cccc", reason: "dev only", expires: "2030-01-01" }];

describe("npm audit gate", () => {
  it("fails on a non-allowlisted high advisory and passes once allowlisted", () => {
    const a = adv("https://github.com/advisories/GHSA-aaaa-bbbb-cccc");
    expect(evaluateAudit(a, []).ok).toBe(false);
    expect(evaluateAudit(a, allow)).toMatchObject({ ok: true, allowed: ["GHSA-aaaa-bbbb-cccc"] });
  });
  it("ignores moderate, fails critical, expires allowlist entries, fails closed without a report", () => {
    expect(evaluateAudit(adv("https://github.com/advisories/GHSA-x", "moderate"), []).ok).toBe(true);
    expect(evaluateAudit(adv("https://github.com/advisories/GHSA-x", "critical"), []).ok).toBe(false);
    const expired = [{ ...allow[0], expires: "2020-01-01" }];
    expect(evaluateAudit(adv("https://github.com/advisories/GHSA-aaaa-bbbb-cccc"), expired).problems[0]).toMatch(/expired/);
    expect(evaluateAudit({ error: { summary: "ENOTFOUND" } }, allow).ok).toBe(false);
    expect(evaluateAudit(adv("https://github.com/advisories/GHSA-aaaa-bbbb-cccc"), [{ id: allow[0].id }]).ok).toBe(false);
  });
  it("blocks packages with no advisory detail by name", () => {
    expect(evaluateAudit({ vulnerabilities: { foo: { severity: "high", via: [] } } }, []).ok).toBe(false);
  });
  it("keeps dependency-review allow-ghsas in sync with the audit allowlist", () => {
    const ids = (JSON.parse(read(".github/audit-allowlist.json")) as { id: string }[]).map((e) => e.id).sort();
    const cfg = read(".github/dependency-review-config.yml");
    const yamlIds = [...cfg.matchAll(/^\s+- (GHSA-[a-z0-9-]+)\s*$/gim)].map((m) => m[1]).sort();
    expect(yamlIds).toEqual(ids);
    expect(cfg).toMatch(/fail-on-severity: high/);
  });
  it("CI runs the blocking gate (no continue-on-error on it)", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/run: node scripts\/npm-audit-gate\.mjs/);
    expect(ci).not.toMatch(/npm audit[^\n]*\n\s+run:[^\n]*\n\s+continue-on-error/);
  });
});

describe("action pinning", () => {
  it("every uses: in .github/workflows is a full commit SHA", () => {
    const dir = join(root, ".github/workflows");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".yml"))) {
      expect(unpinnedUses(read(`.github/workflows/${f}`)), f).toEqual([]);
    }
  });
  it("detects tags, branches and accepts SHAs with comments", () => {
    expect(unpinnedUses("- uses: actions/checkout@v4\n- uses: a/b@main")).toHaveLength(2);
    expect(unpinnedUses(`uses: a/b@${"a".repeat(40)} # v1\nuses: ./local\nuses: docker://x:1`)).toEqual([]);
    expect(unpinnedUses(`uses: a/b@${"a".repeat(39)}`)).toHaveLength(1);
  });
  it("Dependabot keeps pins fresh and the dependency review workflow exists", () => {
    expect(read(".github/dependabot.yml")).toMatch(/package-ecosystem: github-actions/);
    expect(read(".github/workflows/dependency-review.yml")).toMatch(/dependency-review-action@[0-9a-f]{40}/);
  });
});
