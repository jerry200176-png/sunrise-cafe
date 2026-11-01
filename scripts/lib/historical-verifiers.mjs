import { createHash } from "node:crypto";
import { readFileSync, lstatSync } from "node:fs";
import { resolve } from "node:path";

// A closed, code-reviewed capability registry. Changing a verifier or its direct
// dependencies requires an explicit pin update and review; this cannot protect
// against a malicious change that also rewrites the registry and its tests.
export const VERIFIERS = Object.freeze({
  "bank-transfer": "scripts/verify-bank-transfer-reports.mjs",
  "line-pay": "scripts/verify-line-pay-safety.mjs",
  "market-parity": "scripts/verify-market-parity.mjs",
});
export const HISTORICAL_ENTRIES = Object.freeze([
  { version: "20260914-bank-transfer-reports", file: "migration-bank-transfer-reports.sql", phase: "predeploy", sql_class: "grandfathered", verifier: "bank-transfer" },
  { version: "20260813-line-pay-payments", file: "migration-line-pay-payments.sql", phase: "postdeploy", sql_class: "grandfathered", verifier: "line-pay" },
  { version: "20260813-line-pay-safety", file: "migration-line-pay-safety.sql", phase: "postdeploy", sql_class: "grandfathered", verifier: "line-pay" },
  { file: "migration-market-parity-rounds-3-7.sql", phase: "postdeploy", sql_class: "additive", verifier: "market-parity", execution: "workflow_untracked_contract" },
]);
export const LEGACY_RUNNERS = Object.freeze([
  "scripts/apply-migration-bank-transfer-reports.mjs",
  "scripts/apply-migration-line-pay-safety.mjs",
  "scripts/apply-migration-market-parity.mjs",
]);
export const PINS = Object.freeze({
  "scripts/verify-bank-transfer-reports.mjs": "a4ff060a2d3b5d9b8db141b52c72af0590bec020f8e88fe02fece2e65b23b2af",
  "scripts/verify-line-pay-safety.mjs": "8c2a7a43f496511d82471aa26b0fcd8a15e6c213f00eebdf1f11924a9727467e",
  "scripts/verify-market-parity.mjs": "de856349addc3da25a7600f1fcb4cc25e92f5dbcca9270e7ab2282ab73e0bdfd",
  "scripts/lib/bank-transfer-acl.mjs": "b36a1af83b49e885f8bb995a4d041e5b1f6338831e0a99a84ea267a5c920f292",
  "scripts/lib/ops-postgres.mjs": "b92d310521b0ea7a64299d9aeb33abcde1ab8ce67c146f00c1ed81353768ba9d",
  "scripts/lib/rest-schema-probe.mjs": "f558090d3d2b94152202f13f2133f592a5cd06751082f068ecad5f791744402a",
  "supabase/migration-bank-transfer-reports.sql": "64f5adaefa6197ad2b23add5e231b9119e768d5a176d051153da4e31c683a1ed",
  "supabase/migration-line-pay-payments.sql": "9cb502c75394d35f3795e46f6fbc3f70db18b0408bdd33e8e82dc036a09e11fb",
  "supabase/migration-line-pay-safety.sql": "060bb9dbce506d947fd87aad7400a6c8a4fe3bf900c48b40bd3d657dead04fb8",
  "supabase/migration-market-parity-rounds-3-7.sql": "b50b60c04449ec9266f63e34bb58d8c4d714c36e47f923b9b0c8bcd21e9b15d9",
});

export function assertHistoricalVerifierPlan(plan) {
  for (const entry of plan.entries) {
    if (entry.verifier && !Object.hasOwn(VERIFIERS, entry.verifier)) throw new Error("Unknown historical verifier");
    const fixed = HISTORICAL_ENTRIES.find((item) =>
      resolve("supabase", item.file) === resolve("supabase", entry.file) || (item.version && item.version === entry.version));
    if (!fixed && entry.verifier) throw new Error("Unregistered verifier entry");
    if (fixed && (entry.runner !== undefined || Object.keys(entry).length !== Object.keys(fixed).length || Object.keys(fixed).some((key) => entry[key] !== fixed[key]))) {
      throw new Error(`Historical verifier contract changed: ${fixed.file}`);
    }
  }
  for (const fixed of HISTORICAL_ENTRIES) {
    if (plan.entries.filter((entry) => entry.file === fixed.file && entry.version === fixed.version).length !== 1) {
      throw new Error(`Historical verifier missing or duplicated: ${fixed.file}`);
    }
  }
}

export function assertVerifierFiles(root) {
  for (const legacy of LEGACY_RUNNERS) {
    try { lstatSync(resolve(root, legacy)); }
    catch (error) { if (error?.code === "ENOENT") continue; throw error; }
    throw new Error(`Historical writable runner must not exist: ${legacy}`);
  }
  for (const [path, expected] of Object.entries(PINS)) {
    const absolute = resolve(root, path);
    if (!lstatSync(absolute).isFile()) throw new Error(`Not a regular verifier file: ${path}`);
    const actual = createHash("sha256").update(readFileSync(absolute)).digest("hex");
    if (actual !== expected) throw new Error(`Historical verifier hash mismatch: ${path}`);
  }
}
