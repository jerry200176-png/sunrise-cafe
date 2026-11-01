import { readFileSync } from "node:fs";
import { VERIFIERS } from "../../scripts/lib/historical-verifiers.mjs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  executePhase,
  phaseEntries,
  phaseExecutionUnits,
  validateMigrationPlan,
} from "../../scripts/run-production-migration-phase.mjs";
import { applyBookingMeals, migrationBody } from "../../scripts/apply-migration-booking-meals.mjs";
import { applyPreorderMenuSeed, migrationBody as menuSeedBody } from "../../scripts/apply-migration-preorder-menu-seed.mjs";
import { applyBranchGuestSettings, migrationBody as branchGuestSettingsBody } from "../../scripts/apply-migration-branch-guest-settings.mjs";
import { applyBranchWeeklyHours, migrationBody as branchWeeklyHoursBody } from "../../scripts/apply-migration-branch-weekly-hours.mjs";
import { applyNoShowAdvice, migrationBody as noShowAdviceBody } from "../../scripts/apply-migration-no-show-advice.mjs";
import { applyBranchesArchive, migrationBody as branchesArchiveBody } from "../../scripts/apply-migration-branches-archive.mjs";
import { applyLineDeliveries, migrationBody as lineDeliveriesBody } from "../../scripts/apply-migration-line-deliveries.mjs";
import { applyMenuOptionSets, migrationBody as menuOptionSetsBody } from "../../scripts/apply-migration-menu-option-sets.mjs";
import { applyDepositTransferInfo, migrationBody as depositTransferInfoBody } from "../../scripts/apply-migration-reservations-deposit-transfer-info.mjs";

const root = process.cwd();
const plan = JSON.parse(
  readFileSync(join(root, "scripts/production-migration-plan.json"), "utf8")
) as {
  schema_version: number;
  entries: Array<{
    version?: string;
    file: string;
    runner?: string;
    verifier?: keyof typeof VERIFIERS;
    execution?: string;
    phase?: "predeploy" | "postdeploy";
  }>;
};
const contracts = JSON.parse(
  readFileSync(join(root, "supabase/tracked-migration-contracts.json"), "utf8")
) as Array<{ version: string; file: string }>;
const workflow = readFileSync(
  join(root, ".github/workflows/production-deploy-migrate.yml"),
  "utf8"
);
const bankTransferMigration = readFileSync(
  join(root, "supabase/migration-bank-transfer-reports.sql"),
  "utf8"
);
const bankTransferRunner = readFileSync(
  join(root, "scripts/verify-bank-transfer-reports.mjs"),
  "utf8"
);
const bankTransferAcl = readFileSync(join(root, "scripts/lib/bank-transfer-acl.mjs"), "utf8");

describe("explicit production migration plan", () => {
  it("requires an explicit phase for every executable entry", () => {
    expect(() => validateMigrationPlan(plan)).not.toThrow();
    expect(plan.schema_version).toBe(2);
    for (const entry of plan.entries.filter((item) => item.runner || item.verifier)) {
      expect(["predeploy", "postdeploy"]).toContain(entry.phase);
    }
    expect(plan.entries.find((entry) => entry.version === "20260914-bank-transfer-reports")?.phase).toBe(
      "predeploy"
    );
  });

  it("covers every tracked migration contract", () => {
    const planned = new Set(plan.entries.map((entry) => `${entry.version}:${entry.file}`));
    for (const contract of contracts) {
      expect(planned.has(`${contract.version}:${contract.file}`)).toBe(true);
    }
  });

  it("maps every executable entry to a checked-in SQL file and runner", () => {
    for (const entry of plan.entries) {
      expect(() => readFileSync(join(root, "supabase", entry.file))).not.toThrow();
      if (entry.verifier) {
        const verifierSource = readFileSync(join(root, VERIFIERS[entry.verifier]), "utf8");
        expect(verifierSource).toContain(entry.file);
        continue;
      }
      if (!entry.runner) {
        expect(entry.execution).toBe("manual_sql_editor");
        continue;
      }
      expect(entry.runner).toMatch(/^scripts\/apply-migration-[\w-]+\.mjs$/);
      const runnerSource = readFileSync(join(root, entry.runner), "utf8");
      expect(runnerSource).toContain(entry.file);
    }
    expect(workflow).not.toMatch(/node scripts\/apply-migration-[\w-]+\.mjs/);
  });

  it("plans only the requested phase and deduplicates shared runners", () => {
    const predeployEntries = phaseEntries(plan, "predeploy") as typeof plan.entries;
    const postdeployEntries = phaseEntries(plan, "postdeploy") as typeof plan.entries;
    const postdeployUnits = phaseExecutionUnits(plan, "postdeploy") as typeof plan.entries;
    expect(predeployEntries.map((entry) => entry.version)).toEqual([
      "20260914-bank-transfer-reports",
      "20260921-reservation-preorder",
      "20260924-booking-meals",
      "20260924-preorder-menu-seed",
      "20260928-branch-guest-settings",
      "20260928-branch-weekly-hours",
      "20260929-reservations-deposit-transfer-info",
      "20261008-branches-archive",
      "20261008-line-deliveries",
      "20261009-menu-option-sets",
      "20261011-no-show-advice",
    ]);
    expect(postdeployUnits.length).toBeLessThan(postdeployEntries.length);
    expect(postdeployUnits.every((entry) => entry.phase === "postdeploy")).toBe(true);
  });

  it("runs the preorder prerequisite before booking meals and rejects a missing prerequisite", async () => {
    const units = phaseExecutionUnits(plan, "predeploy") as typeof plan.entries;
    expect(units.map((entry) => entry.runner).slice(-9)).toEqual([
      "scripts/apply-migration-booking-meals.mjs",
      "scripts/apply-migration-preorder-menu-seed.mjs",
      "scripts/apply-migration-branch-guest-settings.mjs",
      "scripts/apply-migration-branch-weekly-hours.mjs",
      "scripts/apply-migration-reservations-deposit-transfer-info.mjs",
      "scripts/apply-migration-branches-archive.mjs",
      "scripts/apply-migration-line-deliveries.mjs",
      "scripts/apply-migration-menu-option-sets.mjs",
      "scripts/apply-migration-no-show-advice.mjs",
    ]);
    let began = false;
    const sql = Object.assign(async () => [], { begin: async () => { began = true; } });
    await expect(applyBookingMeals(sql as never)).rejects.toThrow(/Prerequisite migration missing/);
    expect(began).toBe(false);
    const source = readFileSync(join(root, "supabase/migration-booking-meals.sql"), "utf8");
    const body = migrationBody(source);
    expect(body).toContain("CREATE OR REPLACE FUNCTION public.create_booking_with_meals");
    expect(body).not.toMatch(/^BEGIN;/);
    expect(body).not.toMatch(/COMMIT;\s*$/);
    await expect(applyPreorderMenuSeed(sql as never)).rejects.toThrow(/Prerequisite migration missing/);
    const seed = menuSeedBody(readFileSync(join(root, "supabase/migration-preorder-menu-seed.sql"), "utf8"));
    expect(seed).toContain("WHERE is_available = true");
    expect(seed).toContain("AND preorder_eligible = false");
    expect(seed).not.toMatch(/REFERENCES menu_items/i);
  });

  it("adds only nullable branch override columns and fails closed when they are missing", async () => {
    const body = branchGuestSettingsBody(readFileSync(join(root, "supabase/migration-branch-guest-settings.sql"), "utf8"));
    for (const column of ["rental_notes jsonb", "deposit_info text", "google_review_url text"]) {
      expect(body).toContain(`ADD COLUMN IF NOT EXISTS ${column};`);
    }
    expect(body).not.toMatch(/\b(UPDATE|DELETE|DROP|NOT NULL|DEFAULT)\b/i);
    expect(() => branchGuestSettingsBody("BEGIN;\nSELECT 1;\n")).toThrow(/wrapper changed/);

    // Ledger says applied but the columns are gone: verification must stop the deploy.
    const sql = Object.assign(
      async (strings: TemplateStringsArray) => (strings.join("").includes("schema_migrations") ? [{ "?column?": 1 }] : []),
      { begin: async () => {} }
    );
    await expect(applyBranchGuestSettings(sql as never)).rejects.toThrow(/override columns missing/);
  });

  it("line_deliveries migration is additive, wrapped in a transaction, and verified after apply", async () => {
    const source = readFileSync(join(root, "supabase/migration-line-deliveries.sql"), "utf8");
    const body = lineDeliveriesBody(source);
    expect(body).toContain("CREATE TABLE IF NOT EXISTS line_deliveries");
    // service-role only: RLS on, no policy for anon/authenticated, explicit revokes, pinned search_path
    expect(body).toContain("ENABLE ROW LEVEL SECURITY");
    expect(body).toMatch(/REVOKE ALL ON TABLE line_deliveries FROM PUBLIC, anon, authenticated/);
    expect(body).toMatch(/REVOKE ALL ON FUNCTION claim_line_delivery\([^)]*\) FROM PUBLIC, anon, authenticated/);
    expect(body).toContain("SET search_path = public, pg_temp");
    const code = body.replace(/^--.*$/gm, "");
    expect(code).not.toMatch(/\bGRANT [^;]*(anon|authenticated)/i);
    expect(body).not.toMatch(/CREATE POLICY[^;]*(anon|authenticated|PUBLIC)/i);
    expect(body).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE|ALTER TABLE (?!line_deliveries)/i);
    const sql = Object.assign(async () => [], { begin: async () => {} });
    await expect(applyLineDeliveries(sql as never)).rejects.toThrow(/missing from schema_migrations/);
  });

  it("adds only the nullable weekly_hours column and fails closed when it is missing", async () => {
    const body = branchWeeklyHoursBody(readFileSync(join(root, "supabase/migration-branch-weekly-hours.sql"), "utf8"));
    expect(body).toContain("ADD COLUMN IF NOT EXISTS weekly_hours jsonb;");
    expect(body).not.toMatch(/\b(UPDATE|DELETE|DROP|NOT NULL|DEFAULT)\b/i);
    const sql = Object.assign(
      async (strings: TemplateStringsArray) => (strings.join("").includes("schema_migrations") ? [{ "?column?": 1 }] : []),
      { begin: async () => {} }
    );
    await expect(applyBranchWeeklyHours(sql as never)).rejects.toThrow(/weekly_hours column missing/);
  });

  it("adds only nullable deposit transfer columns and fails closed when they are missing", async () => {
    const body = depositTransferInfoBody(
      readFileSync(join(root, "supabase/migration-reservations-deposit-transfer-info.sql"), "utf8")
    );
    expect(body).toContain("ADD COLUMN IF NOT EXISTS deposit_paid_on date");
    expect(body).toContain("ADD COLUMN IF NOT EXISTS deposit_last_five text");
    expect(body).not.toMatch(/\b(UPDATE|DELETE|NOT NULL|DEFAULT)\b/i);
    const sql = Object.assign(
      async (strings: TemplateStringsArray) => (strings.join("").includes("schema_migrations") ? [{ "?column?": 1 }] : []),
      { begin: async () => {} }
    );
    await expect(applyDepositTransferInfo(sql as never)).rejects.toThrow(/deposit transfer columns missing/);
  });

  it("no-show advice: widens one CHECK, adds one table, deletes nothing, fails closed", async () => {
    const body = noShowAdviceBody(readFileSync(join(root, "supabase/migration-no-show-advice.sql"), "utf8"));
    expect(body).toContain("'no_show'");
    expect(body).toContain("CREATE TABLE IF NOT EXISTS advice_decisions");
    expect(body).toContain("TO service_role");
    expect(body).not.toMatch(/\b(DELETE FROM|TRUNCATE|DROP TABLE|UPDATE)\b/i);
    const sql = Object.assign(
      async (strings: TemplateStringsArray) => (strings.join("").includes("schema_migrations") ? [{ "?column?": 1 }] : []),
      { begin: async () => {} }
    );
    await expect(applyNoShowAdvice(sql as never)).rejects.toThrow(/advice_decisions table missing/);
  });

  it("adds archived_at and a delete guard, touches no existing rows, and fails closed when missing", async () => {
    const body = branchesArchiveBody(readFileSync(join(root, "supabase/migration-branches-archive.sql"), "utf8"));
    expect(body).toContain("ADD COLUMN IF NOT EXISTS archived_at timestamptz;");
    expect(body).toContain("BEFORE DELETE ON branches");
    expect(body).toContain("RAISE EXCEPTION");
    expect(body).not.toMatch(/\b(UPDATE|NOT NULL|DEFAULT|TRUNCATE)\b/i);
    expect(body).not.toMatch(/DELETE FROM/i);
    const sql = Object.assign(
      async (strings: TemplateStringsArray) => (strings.join("").includes("schema_migrations") ? [{ "?column?": 1 }] : []),
      { begin: async () => {} }
    );
    await expect(applyBranchesArchive(sql as never)).rejects.toThrow(/archived_at column missing/);
  });

  it("option sets: needs the booking-meals prerequisite, never deletes data, fails closed", async () => {
    const body = menuOptionSetsBody(readFileSync(join(root, "supabase/migration-menu-option-sets.sql"), "utf8"));
    expect(body).toContain("CREATE TABLE IF NOT EXISTS menu_option_sets");
    expect(body).toContain("assert_menu_item_option_selection");
    expect(body).toContain("CREATE OR REPLACE FUNCTION public.submit_reservation_preorder");
    expect(body).not.toMatch(/DELETE FROM menu_item_options|TRUNCATE|DROP TABLE|DROP COLUMN/i);
    let began = false;
    const empty = Object.assign(async () => [], { begin: async () => { began = true; } });
    await expect(applyMenuOptionSets(empty as never)).rejects.toThrow(/Prerequisite migration missing/);
    expect(began).toBe(false);
    const ledgerOnly = Object.assign(
      async (strings: TemplateStringsArray) => (strings.join("").includes("schema_migrations") ? [{ "?column?": 1 }] : []),
      { begin: async () => {}, array: (values: unknown[]) => values }
    );
    await expect(applyMenuOptionSets(ledgerOnly as never)).rejects.toThrow(/tables missing/);
  });

  it("fails closed for unknown, missing, or duplicate phases", () => {
    expect(() => phaseEntries(plan, "unknown" as never)).toThrow(/Unknown migration phase/);
    expect(() =>
      validateMigrationPlan({
        schema_version: 2,
        entries: [{ file: "migration.sql", runner: "scripts/apply-migration-x.mjs" }],
      })
    ).toThrow(/no valid phase/);
    expect(() =>
      validateMigrationPlan({
        schema_version: 2,
        entries: [
          { version: "same", file: "migration.sql", runner: "scripts/apply-migration-x.mjs", phase: "predeploy" },
          { version: "same", file: "migration.sql", runner: "scripts/apply-migration-x.mjs", phase: "postdeploy" },
        ],
      })
    ).toThrow(/multiple phases/);
    expect(() =>
      validateMigrationPlan({
        schema_version: 2,
        entries: [
          { version: "same", file: "migration.sql", runner: "scripts/apply-migration-x.mjs", phase: "predeploy" },
          { version: "same", file: "migration.sql", runner: "scripts/apply-migration-x.mjs", phase: "predeploy" },
        ],
      })
    ).toThrow(/duplicated/);
  });

  it("does not run a postdeploy entry during predeploy", async () => {
    const calls: string[] = [];
    await executePhase(plan, "predeploy", async (runner) => calls.push(runner));
    expect(calls).toEqual([
      "scripts/verify-bank-transfer-reports.mjs",
      "scripts/apply-migration-reservation-preorder.mjs",
      "scripts/apply-migration-booking-meals.mjs",
      "scripts/apply-migration-preorder-menu-seed.mjs",
      "scripts/apply-migration-branch-guest-settings.mjs",
      "scripts/apply-migration-branch-weekly-hours.mjs",
      "scripts/apply-migration-reservations-deposit-transfer-info.mjs",
      "scripts/apply-migration-branches-archive.mjs",
      "scripts/apply-migration-line-deliveries.mjs",
      "scripts/apply-migration-menu-option-sets.mjs",
      "scripts/apply-migration-no-show-advice.mjs",
    ]);
  });

  it("propagates predeploy failure so the dependent deploy cannot proceed", async () => {
    await expect(
      executePhase(plan, "predeploy", async () => {
        throw new Error("forced predeploy failure");
      })
    ).rejects.toThrow("forced predeploy failure");
  });

  it("treats already-applied and empty postdeploy phases as successful orchestration", async () => {
    const calls: string[] = [];
    const alreadyApplied = await executePhase(plan, "predeploy", async (runner) => {
      calls.push(runner);
      return { status: "already_applied" };
    });
    expect(alreadyApplied.phase).toBe("predeploy");
    expect(calls).toHaveLength((phaseExecutionUnits(plan, "predeploy") as unknown[]).length);
    expect(calls).toHaveLength(11);

    const emptyPlan = { schema_version: 2, entries: [] };
    const postdeploy = await executePhase(emptyPlan, "postdeploy", async () => {
      throw new Error("must not run");
    });
    expect(postdeploy.runners).toEqual([]);
  });

  it("enforces the migration phase dependency graph structurally", () => {
    const jobs = parseJobs(workflow);
    expect(needs(jobs, "predeploy_verify")).toEqual(["predeploy_migrate"]);
    expect(needs(jobs, "deploy")).toEqual(["predeploy_verify"]);
    expect(needs(jobs, "postdeploy_migrate")).toEqual(["deploy"]);
    expect(needs(jobs, "postdeploy_verify")).toEqual(["postdeploy_migrate"]);
    expect(jobs.get("predeploy_verify")).not.toMatch(/if:\s*always\(\)/);
    expect(jobs.get("deploy")).not.toMatch(/if:\s*always\(\)/);
    expect(jobs.get("predeploy_migrate")).toContain("node scripts/run-production-migration-phase.mjs predeploy");
    expect(jobs.get("postdeploy_migrate")).toContain("node scripts/run-production-migration-phase.mjs postdeploy");
  });

  it("keeps bank-transfer RPCs service-role-only for Supabase roles", () => {
    expect(bankTransferMigration).toMatch(
      /REVOKE ALL ON FUNCTION record_bank_transfer_report\(UUID, TEXT, NUMERIC\) FROM anon, authenticated;/
    );
    expect(bankTransferMigration).toMatch(
      /REVOKE ALL ON FUNCTION confirm_bank_transfer_payment\(UUID, TEXT, TEXT\) FROM anon, authenticated;/
    );
    expect(bankTransferAcl).toContain("authenticated_report");
    expect(bankTransferAcl).toContain("authenticated_confirm");
    expect(bankTransferRunner).not.toContain("role_privileges_repaired");
  });
});

function parseJobs(source: string): Map<string, string> {
  const lines = source.split("\n");
  const jobs = new Map<string, string>();
  let current: string | null = null;
  let block: string[] = [];
  for (const line of lines) {
    const match = /^  ([a-z][a-z0-9_-]*):\s*$/.exec(line);
    if (match) {
      if (current) jobs.set(current, block.join("\n"));
      current = match[1];
      block = [];
    } else if (current) {
      block.push(line);
    }
  }
  if (current) jobs.set(current, block.join("\n"));
  return jobs;
}

function needs(jobs: Map<string, string>, job: string): string[] {
  const block = jobs.get(job);
  if (!block) throw new Error(`Missing workflow job ${job}`);
  const inline = /\n    needs:\s*([^\n]+)/.exec(`\n${block}`)?.[1]?.trim();
  if (!inline) return [];
  if (inline.startsWith("[")) return JSON.parse(inline.replaceAll("'", '"')) as string[];
  return [inline];
}
