import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(resolve(root, relativePath), "utf8");

const verifyWorkflow = await read(".github/workflows/verify-production.yml");
const deployWorkflow = await read(".github/workflows/production-deploy-migrate.yml");
const deployScript = await read("scripts/orchestrator/deploy.sh");
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

assert.match(ignoredBuild, /VERCEL_ENV/);
assert.match(ignoredBuild, /VERCEL_GIT_PREVIOUS_SHA/);
assert.match(ignoredBuild, /VERCEL_GIT_COMMIT_SHA/);
assert.match(ignoredBuild, /git diff --name-only/);
assert.match(ignoredBuild, /documentation\/governance-only commit/);

console.log("Production deployment workflow contract passed.");
