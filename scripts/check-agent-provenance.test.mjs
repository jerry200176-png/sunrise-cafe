import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

const checker = new URL("./check-agent-provenance.sh", import.meta.url).pathname;
const SESSION = "cse_01TESTCLOUDSESSION";
const URL_OK = `https://claude.ai/code/session_${SESSION.slice(4)}`;
const BRANCH = "chore/task-GOV-CLOUD-TEST-1";
const fixtures = [];

const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

function commit(root, file, trailer) {
  writeFileSync(path.join(root, file), `${file}\n`);
  git(root, ["add", file]);
  git(root, ["commit", "--quiet", "-m", `change ${file}${trailer ? `\n\n${trailer}` : ""}`]);
}

function fixture({ trailers = [`Claude-Session: ${URL_OK}`], manifest = {} } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "sunrise-provenance-"));
  fixtures.push(root);
  git(root, ["init", "--quiet", "-b", BRANCH]);
  git(root, ["config", "user.name", "Provenance Test"]);
  git(root, ["config", "user.email", "provenance@example.invalid"]);
  commit(root, "base.txt");
  const base = git(root, ["rev-parse", "HEAD"]);
  trailers.forEach((trailer, index) => commit(root, `work-${index}.txt`, trailer));
  mkdirSync(path.join(root, ".agent-session"), { recursive: true });
  writeFileSync(path.join(root, ".agent-session", "manifest.json"), JSON.stringify({
    schema_version: "1.0",
    provenance_type: "agent-session-cloud",
    project: "sunrise",
    task_id: "GOV-CLOUD-TEST-1",
    session_id: SESSION,
    session_urls: [URL_OK],
    repo_remote: "https://github.com/jerry200176-png/sunrise-cafe.git",
    base_sha: base,
    branch: BRANCH,
    started_at: "2026-10-14T08:00:00Z",
    production_mutation: false,
    preflight_result: "pass",
    preflight_mode: "cloud",
    runner: "claude-code-remote",
    ...manifest,
  }));
  return root;
}

function check(root, env = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.GITHUB_ACTOR;
  delete childEnv.PR_AUTHOR;
  if (!("GITHUB_HEAD_REF" in env)) delete childEnv.GITHUB_HEAD_REF;
  delete childEnv.GITHUB_BASE_REF;
  return spawnSync("bash", [checker], { cwd: root, encoding: "utf8", env: childEnv });
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("cloud provenance passes when every commit carries this session's trailer", () => {
  const result = check(fixture({ trailers: [`Claude-Session: ${URL_OK}`, `Co-Authored-By: x\nClaude-Session: ${URL_OK}`] }));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /agent-session-cloud-ok commits=2/);
});

test("cloud provenance follows the PR branch in CI", () => {
  assert.equal(check(fixture(), { GITHUB_HEAD_REF: BRANCH }).status, 0);
  const wrong = check(fixture(), { GITHUB_HEAD_REF: "chore/task-GOV-CLOUD-TEST-1-other" });
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /!= GitHub PR branch/);
});

test("a commit without the trailer, or with another session's trailer, fails", () => {
  const missing = check(fixture({ trailers: [`Claude-Session: ${URL_OK}`, ""] }));
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /has no Claude-Session trailer/);
  const foreign = check(fixture({ trailers: ["Claude-Session: https://claude.ai/code/session_01SOMEONEELSE"] }));
  assert.notEqual(foreign.status, 0);
});

test("session id must match a listed session url", () => {
  const result = check(fixture({ manifest: { session_id: "cse_01DIFFERENTONE" } }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /session_id does not match/);
});

test("cloud manifest cannot claim a production mutation, a failed preflight or a foreign repo", () => {
  for (const manifest of [
    { production_mutation: true },
    { preflight_result: "fail" },
    { preflight_mode: "local" },
    { runner: "something-else" },
    { repo_remote: "https://github.com/evil/sunrise-cafe.git" },
    { task_id: "NOT-IN-BRANCH-9" },
  ]) {
    assert.notEqual(check(fixture({ manifest })).status, 0, JSON.stringify(manifest));
  }
});
