#!/usr/bin/env node
/** Execute the explicitly approved migration entries for one deployment phase. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PLAN_PATH = resolve(ROOT, "scripts/production-migration-plan.json");
const PHASES = new Set(["predeploy", "postdeploy"]);

export function validateMigrationPlan(plan) {
  if (plan?.schema_version !== 2 || !Array.isArray(plan.entries)) {
    throw new Error("Unsupported production migration plan schema");
  }

  const identities = new Map();
  for (const entry of plan.entries) {
    if (!entry || typeof entry.file !== "string" || !entry.file) {
      throw new Error("Migration plan entry is missing file");
    }
    if (entry.runner) {
      if (!PHASES.has(entry.phase)) {
        throw new Error(`Executable migration ${entry.file} has no valid phase`);
      }
    } else if (entry.phase !== undefined) {
      throw new Error(`Manual migration ${entry.file} cannot have an execution phase`);
    } else if (entry.execution !== "manual_sql_editor") {
      throw new Error(`Migration ${entry.file} has no explicit execution contract`);
    }

    const identity = `${entry.version ?? ""}:${entry.file}`;
    const prior = identities.get(identity);
    if (prior) {
      if (prior.phase !== entry.phase) {
        throw new Error(`Migration ${identity} is assigned to multiple phases`);
      }
      throw new Error(`Migration ${identity} is duplicated in the production plan`);
    }
    identities.set(identity, entry);
  }
  return plan;
}

export function phaseEntries(plan, phase) {
  if (!PHASES.has(phase)) throw new Error(`Unknown migration phase: ${phase}`);
  validateMigrationPlan(plan);
  return plan.entries.filter((entry) => entry.phase === phase);
}

export function phaseExecutionUnits(plan, phase) {
  const seen = new Set();
  return phaseEntries(plan, phase).filter((entry) => {
    if (seen.has(entry.runner)) return false;
    seen.add(entry.runner);
    return true;
  });
}

export async function executePhase(plan, phase, execute = executeRunner) {
  const units = phaseExecutionUnits(plan, phase);
  for (const entry of units) {
    await execute(entry.runner, entry);
  }
  return {
    phase,
    migrations: phaseEntries(plan, phase).map((entry) => entry.version ?? entry.file),
    runners: units.map((entry) => entry.runner),
  };
}

function executeRunner(runner) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(ROOT, runner)], {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) return resolvePromise();
      reject(new Error(`${runner} failed${signal ? ` (${signal})` : ` (exit ${code})`}`));
    });
  });
}

async function main() {
  const phase = process.argv[2];
  const plan = JSON.parse(readFileSync(PLAN_PATH, "utf8"));
  const result = await executePhase(plan, phase);
  console.log(JSON.stringify({ ...result, status: result.runners.length ? "complete" : "no_op" }));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
