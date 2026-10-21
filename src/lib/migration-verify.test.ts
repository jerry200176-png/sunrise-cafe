import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  TRACKED_MIGRATIONS,
  CLOSED_DATES_FILE,
  verifyMigrationArtifacts,
  fetchMigrationDrift,
  evaluateMigrationDrift,
  classifyVersion,
  resolveEvidenceResults,
  isFullEvidencePresent,
  isRealSupabaseConfigured,
  formatDriftReport,
  loadTrackedMigrationContracts,
  type EvidenceSpec,
} from "@/lib/migration-verify";

const REPO_ROOT = join(__dirname, "../..");

describe("verifyMigrationArtifacts (static)", () => {
  it("all tracked migration files exist with schema_migrations records", () => {
    const errors = verifyMigrationArtifacts(REPO_ROOT);
    expect(errors).toEqual([]);
  });

  it("lists expected tracked versions from contracts JSON", () => {
    const contracts = loadTrackedMigrationContracts(REPO_ROOT);
    expect(contracts.map((m) => m.version)).toContain("20260710-reservations-no-overlap");
    expect(existsSync(join(REPO_ROOT, "supabase", CLOSED_DATES_FILE))).toBe(true);
    expect(TRACKED_MIGRATIONS.length).toBe(contracts.length);
  });
});

describe("classifyVersion / evidence", () => {
  const restOnly: EvidenceSpec[] = [
    { type: "table", name: "ops_events", introspect: "rest" },
    { type: "column", table: "ops_events", name: "domain", introspect: "rest" },
  ];

  it("ledger hit → applied", () => {
    expect(
      classifyVersion({
        inLedger: true,
        evidence: resolveEvidenceResults(restOnly, {
          "ops_events.*": true,
          "ops_events.domain": true,
        }),
      })
    ).toBe("applied");
  });

  it("full REST evidence present + not in ledger → case_b_candidate", () => {
    const evidence = resolveEvidenceResults(restOnly, {
      "ops_events.*": true,
      "ops_events.domain": true,
    });
    expect(classifyVersion({ inLedger: false, evidence })).toBe("case_b_candidate");
    expect(isFullEvidencePresent(evidence)).toBe(true);
  });

  it("partial evidence (table only) → true_pending", () => {
    const evidence = resolveEvidenceResults(restOnly, {
      "ops_events.*": true,
      "ops_events.domain": false,
    });
    expect(classifyVersion({ inLedger: false, evidence })).toBe("true_pending");
    expect(isFullEvidencePresent(evidence)).toBe(false);
  });

  it("table present but policy unsupported → unknown (not Case B)", () => {
    const mixed: EvidenceSpec[] = [
      { type: "table", name: "branches", introspect: "rest" },
      { type: "policy", name: "Allow anon select branches", table: "branches", introspect: "unsupported" },
    ];
    const evidence = resolveEvidenceResults(mixed, { "branches.*": true });
    expect(classifyVersion({ inLedger: false, evidence })).toBe("unknown");
    expect(isFullEvidencePresent(evidence)).toBe(false);
  });
});

describe("evaluateMigrationDrift", () => {
  const miniContracts = [
    {
      version: "20260713-ops-events",
      file: "migration-ops-events.sql",
      critical: false,
      evidence: [
        { type: "table" as const, name: "ops_events", introspect: "rest" as const },
        { type: "column" as const, table: "ops_events", name: "domain", introspect: "rest" as const },
      ],
    },
  ];

  it("passes when ledger has version and closed_dates present", () => {
    const report = evaluateMigrationDrift({
      applied: ["20260713-ops-events"],
      contracts: miniContracts,
      restProbes: {
        "ops_events.*": true,
        "ops_events.domain": true,
        "branches.closed_dates": true,
      },
      closedDatesColumn: true,
    });
    expect(report.status).toBe("pass");
    expect(report.ok).toBe(true);
    expect(report.classifications[0].classification).toBe("applied");
  });

  it("fails as drift for Case B candidate (does not auto-pass)", () => {
    const report = evaluateMigrationDrift({
      applied: [],
      contracts: miniContracts,
      restProbes: {
        "ops_events.*": true,
        "ops_events.domain": true,
        "branches.closed_dates": true,
      },
      closedDatesColumn: true,
    });
    expect(report.status).toBe("drift");
    expect(report.ok).toBe(false);
    expect(report.case_b_candidates).toContain("20260713-ops-events");
  });

  it("does not misreport transport failure as pending migrations", () => {
    const report = evaluateMigrationDrift({
      applied: null,
      transportError: "Node.js 20 detected without native WebSocket support.",
      contracts: miniContracts,
    });
    expect(report.status).toBe("probe_error");
    expect(report.ok).toBe(false);
    expect(report.pending).toEqual([]);
    expect(formatDriftReport(report)).toMatch(/probe_error/);
  });

  it("real contracts: unsupported policy/constraint → unknown not Case B", () => {
    const contracts = loadTrackedMigrationContracts(REPO_ROOT);
    const report = evaluateMigrationDrift({
      applied: [],
      contracts,
      restProbes: {
        "admin_users.*": true,
        "admin_users.email": true,
        "admin_users.password_hash": true,
        "admin_users.role": true,
        "admin_user_branches.user_id": true,
        "admin_user_branches.branch_id": true,
        "admin_permission_audit.*": true,
        "admin_permission_audit.action": true,
        "ops_events.*": true,
        "ops_events.ts": true,
        "ops_events.domain": true,
        "ops_events.action": true,
        "ops_events.detail": true,
        "branches.closed_dates": true,
      },
      closedDatesColumn: true,
    });
    expect(report.ok).toBe(false);
    expect(report.case_b_candidates).toEqual([]);
    expect(report.unknown.length).toBeGreaterThan(0);
    expect(report.unknown).toContain("20260715-rls-catalog-read-only");
    expect(report.unknown).toContain("20260710-reservations-no-overlap");
  });
});

describe("fetchMigrationDrift (remote)", () => {
  it.skipIf(isRealSupabaseConfigured())(
    "skips remote when Supabase not configured",
    async () => {
      const report = await fetchMigrationDrift();
      expect(report.mode).toBe("unconfigured");
      expect(report.status).toBe("unconfigured");
      expect(report.ok).toBe(true);
    }
  );
});

describe("verify-production workflow safety (static)", () => {
  const wf = readFileSync(
    join(REPO_ROOT, ".github/workflows/verify-production.yml"),
    "utf8"
  );

  it("does not auto-apply ledger reconciliation", () => {
    expect(wf).not.toMatch(/reconcile-migration-ledger\.mjs[^\n]*--apply/);
    // Allow mentioning --apply only in comments that forbid it
    const commandLines = wf
      .split("\n")
      .filter((l) => /^\s+(- run:|node |bash )/.test(l) || l.includes("reconcile-migration-ledger"));
    expect(commandLines.join("\n")).not.toMatch(/--apply/);
  });

  it("does not export full Vercel production env into the workspace", () => {
    expect(wf).not.toMatch(/vercel-production-env\.sh/);
    expect(wf).not.toMatch(/\.env\.vercel\.prod/);
    expect(wf).not.toMatch(/SUPABASE_DB_URL/);
  });

  it("keeps reconcile dry-run as diagnostic only", () => {
    expect(wf).toMatch(/reconcile-migration-ledger\.mjs/);
    expect(wf).toMatch(/read-only|Diagnostic dry-run/i);
  });
});

describe("reconcile-migration-ledger CLI guards (static)", () => {
  const script = readFileSync(
    join(REPO_ROOT, "scripts/reconcile-migration-ledger.mjs"),
    "utf8"
  );

  it("requires --migration and --confirm-version for apply", () => {
    expect(script).toMatch(/--apply requires --migration/);
    expect(script).toMatch(/--apply requires --confirm-version/);
    expect(script).toMatch(/must exactly match --migration/);
  });

  it("refuses apply when full evidence is not present", () => {
    expect(script).toMatch(/Refuse apply: full evidence contract not proven present/);
  });
});
