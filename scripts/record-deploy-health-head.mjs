#!/usr/bin/env node
/**
 * Record the main commit that the trusted production workflow is processing.
 * This runs in GitHub Actions, not in the Vercel runtime.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const IGNORED_BUILD_PATH = /^(orchestrator\/|docs\/|\.github\/|\.agents\/|\.cursor\/|.*\.md$|CHANGELOG\.md$|LICENSE(\..*)?$|skills-lock\.json$|\.gitignore$)/;

export function isRuntimeChanged(changedFiles) {
  return changedFiles.some((filename) => !IGNORED_BUILD_PATH.test(filename));
}

function command(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function changedFiles(head) {
  const eventBefore = process.env.GITHUB_EVENT_BEFORE?.trim();
  const base = eventBefore && SHA_PATTERN.test(eventBefore) && !/^0+$/.test(eventBefore)
    ? eventBefore
    : (() => {
        try {
          return command(["rev-parse", `${head}^`]);
        } catch {
          return "";
        }
      })();

  if (!base) return null;
  try {
    const output = command(["diff", "--name-only", base, head]);
    return output ? output.split("\n").filter(Boolean) : [];
  } catch {
    return null;
  }
}

async function main() {
  const sha = process.env.GITHUB_SHA?.trim();
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!sha || !SHA_PATTERN.test(sha)) throw new Error("GITHUB_SHA must be a full commit SHA");
  if (!baseUrl || !serviceKey) throw new Error("Supabase workflow credentials are not configured");

  const files = changedFiles(sha);
  const runtimeChanged = files === null ? true : isRuntimeChanged(files);
  const detail = {
    sha: sha.toLowerCase(),
    source: "github-actions",
    runtime_changed: runtimeChanged,
    recorded_at: new Date().toISOString(),
    workflow: process.env.GITHUB_WORKFLOW ?? "",
    run_id: process.env.GITHUB_RUN_ID ?? "",
  };
  const response = await fetch(
    `${baseUrl}/rest/v1/ops_events`,
    {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ domain: "deployment", action: "main_head", detail }),
    }
  );
  if (!response.ok) throw new Error(`Supabase main-head write HTTP ${response.status}`);
  console.log(`Recorded deploy-health main head ${sha.slice(0, 7)} (runtime_changed=${runtimeChanged})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
