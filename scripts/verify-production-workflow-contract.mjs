import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(resolve(root, relativePath), "utf8");

const verifyWorkflow = await read(".github/workflows/verify-production.yml");
const deployWorkflow = await read(".github/workflows/production-deploy-migrate.yml");
const deployScript = await read("scripts/orchestrator/deploy.sh");
const autonomousWorkflow = await read(".github/workflows/autonomous-loop.yml");
const migrationWorkflow = await read(".github/workflows/apply-migration-ops-events.yml");
const autonomousLoop = await read("scripts/orchestrator/loop.sh");
const linePayWorkflow = await read(".github/workflows/ops-linepay-vercel-env.yml");
const linePayScript = await read("scripts/ops-linepay-vercel-env.sh");
const ignoredBuild = await read("scripts/vercel-ignored-build.sh");

assert.match(verifyWorkflow, /group:\s*verify-production-main/);
assert.match(verifyWorkflow, /cancel-in-progress:\s*true/);
assert.match(verifyWorkflow, /timeout-minutes:\s*25/);
assert.match(verifyWorkflow, /for i in \$\(seq 1 40\)/);
assert.doesNotMatch(verifyWorkflow, /VERCEL_TOKEN/);
assert.doesNotMatch(verifyWorkflow, /scripts\/orchestrator\/deploy\.sh/);
assert.match(verifyWorkflow, /Production deploy and migrate is the sole deploy owner/);

assert.match(deployWorkflow, /group:\s*production-deploy-main/);
assert.match(deployWorkflow, /cancel-in-progress:\s*false/);
assert.match(deployWorkflow, /name:\s*Vercel production deploy/);
assert.match(deployWorkflow, /one immediate deploy attempt/);
assert.match(deployWorkflow, /quota\/rate-limit failures/);
assert.match(deployWorkflow, /deploy\.sh --wait 420/);
assert.match(deployScript, /deploy_rate_limited/);
assert.match(deployScript, /Vercel deploy rate limited/);
assert.match(deployScript, /exit 0/);

// The canonical workflow is the only repository-controlled application
// production deploy caller. Auxiliary automation may prepare or verify work,
// but must route activation through this migration-first workflow.
const directProductionDeploy =
  /(?:npx\s+)?vercel\s+deploy\s+--prod|(?:bash\s+)?(?:scripts\/orchestrator\/deploy\.sh|\$SCRIPT_DIR\/deploy\.sh)/;
const equivalentProductionDeploy =
  /vercel\s+(?:redeploy|alias|promote)|api\.vercel\.com\/v\d+\/deployments/;
assert.match(deployWorkflow, directProductionDeploy);
assert.doesNotMatch(autonomousWorkflow, directProductionDeploy);
assert.doesNotMatch(autonomousLoop, directProductionDeploy);
assert.doesNotMatch(migrationWorkflow, directProductionDeploy);
assert.doesNotMatch(linePayWorkflow, directProductionDeploy);
assert.doesNotMatch(linePayScript, directProductionDeploy);
assert.doesNotMatch(linePayWorkflow, equivalentProductionDeploy);
assert.doesNotMatch(linePayScript, equivalentProductionDeploy);
assert.match(linePayWorkflow, /gh workflow run production-deploy-migrate\.yml/);
assert.doesNotMatch(migrationWorkflow, /deploy-if-needed/);
assert.doesNotMatch(migrationWorkflow, /if:\s*always\(\)/);
assert.match(autonomousLoop, /deploy-gate\.sh/);

const workflowDir = resolve(root, ".github/workflows");
for (const filename of await readdir(workflowDir)) {
  if (!filename.endsWith(".yml")) continue;
  const source = await read(`.github/workflows/${filename}`);
  if (filename === "production-deploy-migrate.yml") continue;
  assert.doesNotMatch(
    source,
    directProductionDeploy,
    `${filename} must not own a direct application production deploy`
  );
  assert.doesNotMatch(
    source,
    equivalentProductionDeploy,
    `${filename} must not own an equivalent production redeploy`
  );
}

const orchestratorDir = resolve(root, "scripts/orchestrator");
for (const filename of await readdir(orchestratorDir)) {
  if (!filename.endsWith(".sh") || filename === "deploy.sh") continue;
  const source = await read(`scripts/orchestrator/${filename}`);
  assert.doesNotMatch(
    source,
    directProductionDeploy,
    `scripts/orchestrator/${filename} must not bypass the canonical deploy owner`
  );
}

assert.match(ignoredBuild, /VERCEL_ENV/);
assert.match(ignoredBuild, /VERCEL_GIT_PREVIOUS_SHA/);
assert.match(ignoredBuild, /VERCEL_GIT_COMMIT_SHA/);
assert.match(ignoredBuild, /git diff --name-only/);
assert.match(ignoredBuild, /documentation\/governance-only commit/);

console.log("Production deployment workflow contract passed.");
