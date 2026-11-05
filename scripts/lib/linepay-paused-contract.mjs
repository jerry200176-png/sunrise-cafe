import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { load: parseYaml } = createRequire(import.meta.url)("js-yaml");

/** Refuse credentialed or executable LINE Pay paths while operations are paused. */
export function assertLinePayPaused(workflowSource, scriptSource) {
  const workflow = parseYaml(workflowSource);
  assert.deepEqual(Object.keys(workflow.on).sort(), ["pull_request", "workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.env, undefined);
  assert.deepEqual(Object.keys(workflow.jobs).sort(), ["operate", "validate"]);
  const validate = workflow.jobs.validate;
  assert.deepEqual(Object.keys(validate).sort(), ["if", "name", "permissions", "runs-on", "steps", "timeout-minutes"]);
  assert.equal(validate["runs-on"], "ubuntu-latest");
  assert.equal(validate["timeout-minutes"], 15);
  assert.equal(validate.if, "github.event_name == 'pull_request'");
  assert.deepEqual(validate.permissions, { contents: "read" });
  assert.equal(validate.env, undefined);
  assert.equal(validate.steps.length, 4);
  assert.deepEqual(validate.steps.map((step) => Object.keys(step).sort()), [
    ["uses", "with"], ["uses", "with"], ["run"], ["name", "run"],
  ]);
  assert.match(validate.steps[0].uses, /^actions\/checkout@[a-f0-9]{40}$/);
  assert.deepEqual(validate.steps[0].with, { "persist-credentials": false });
  assert.match(validate.steps[1].uses, /^actions\/setup-node@[a-f0-9]{40}$/);
  assert.deepEqual(validate.steps[1].with, { "node-version": "22", cache: "npm" });
  assert.deepEqual(validate.steps.slice(2).map((step) => step.run), [
    "npm ci", "npx vitest run src/lib/ops-linepay-vercel-env.test.ts",
  ]);
  for (const step of validate.steps) assert.equal(step.env, undefined);
  const operate = workflow.jobs.operate;
  assert.deepEqual(Object.keys(operate).sort(), ["if", "name", "permissions", "runs-on", "steps", "timeout-minutes"]);
  assert.equal(operate["runs-on"], "ubuntu-latest");
  assert.equal(operate["timeout-minutes"], 1);
  assert.equal(operate.if, "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'");
  assert.deepEqual(operate.permissions, {});
  assert.equal(operate.env, undefined);
  assert.equal(operate.steps.length, 1);
  assert.deepEqual(Object.keys(operate.steps[0]).sort(), ["name", "run"]);
  assert.equal(operate.steps[0].uses, undefined);
  assert.equal(operate.steps[0].env, undefined);
  assert.equal(operate.steps[0].run.trim(),
    "echo '::error::LINE Pay environment operations are paused until a reviewed safe path is available.'\nexit 1");
  assert.doesNotMatch(JSON.stringify(workflow), /secrets\.|VERCEL_TOKEN|npx\s+vercel|gh\s+workflow\s+run/);
  assert.equal(scriptSource.trim(), [
    "#!/usr/bin/env bash",
    "# Paused: no credentials, environment files, or external services are accessed.",
    "# A reviewed replacement must restore diagnostics and any activation path.",
    "set -euo pipefail",
    'echo "LINE Pay environment operations are paused until a reviewed safe path is available." >&2',
    "exit 1",
  ].join("\n"));
}
