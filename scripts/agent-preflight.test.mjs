import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

const classifier = new URL("./agent-preflight-worktree.mjs", import.meta.url).pathname;
const fixtures = [];

function writeJson(root, relativePath, value) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(root, relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

function writeTicket(root, ticketId, parentId = null) {
  const target = path.join(root, ".exo", "tickets", `${ticketId}.yaml`);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `id: ${ticketId}\nparent_id: ${parentId || "null"}\n`);
}

function createFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "sunrise-agent-preflight-"));
  fixtures.push(root);
  const branch = "chore/task-GOV-TEST-PREFLIGHT";
  const ticketId = "TKT-TEST-PREFLIGHT";
  const parentId = "INT-TEST-PREFLIGHT";
  execFileSync("git", ["init", "--quiet", "-b", branch, root]);
  execFileSync("git", ["config", "user.name", "Preflight Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "preflight@example.invalid"], { cwd: root });
  writeFileSync(path.join(root, "README.md"), "clean product source\n");
  writeJson(root, ".exo/locks/fencing.json", { last_fencing_token: 14 });
  execFileSync("git", ["add", "README.md", ".exo/locks/fencing.json"], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture base"], { cwd: root });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const now = new Date();
  const timestamp = now.toISOString();
  const expiry = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  const lock = {
    owner: "agent:codex",
    role: "implementation",
    ticket_id: ticketId,
    fencing_token: 15,
    created_at: timestamp,
    expires_at: expiry,
    heartbeat_at: timestamp,
    lease_expires_at: expiry,
    updated_at: timestamp,
    workspace: { base: "main", branch: `exo/${ticketId}` },
  };
  writeJson(root, ".exo/locks/fencing.json", { last_fencing_token: 15 });
  writeJson(root, ".exo/locks/ticket.lock.json", lock);
  writeJson(root, ".exo/cache/sessions/agent-codex.active.json", {
    actor: "agent:codex",
    git_branch: branch,
    git_head_sha: head,
    ticket_id: ticketId,
    mode: "work",
    role: "implementation",
    pid: process.pid,
    lock,
  });
  writeTicket(root, ticketId, parentId);
  writeTicket(root, parentId);
  writeJson(root, ".agent-session/manifest.json", {
    schema_version: "1.0",
    session_id: "SESSION-TEST-PREFLIGHT",
    project: "sunrise",
    task_id: "GOV-TEST-PREFLIGHT",
    repo_remote: "https://github.com/jerry200176-png/sunrise-cafe.git",
    base_sha: head,
    branch,
    worktree_path: root,
    started_at: timestamp,
    production_mutation: false,
    preflight_result: "pass",
    provenance_type: "agent-session",
    agent_cli: "codex",
    gateway_version: "test",
  });
  return { root, branch, ticketId, lock };
}

function runClassifier(fixture, extraArgs = [], env = {}, omitActorMarkers = false) {
  const childEnv = { ...process.env, AGENT_ACTOR: "agent:codex", ...env };
  if (omitActorMarkers) {
    delete childEnv.AGENT_ACTOR;
    delete childEnv.EXO_ACTOR;
    delete childEnv.CODEX_THREAD_ID;
    delete childEnv.CODEX_SESSION_ID;
    delete childEnv.CLAUDE_CODE_SESSION_ID;
    delete childEnv.CLAUDECODE;
  }
  return spawnSync(process.execPath, [
    classifier,
    "--root",
    fixture.root,
    "--branch",
    fixture.branch,
    ...extraArgs,
  ], {
    encoding: "utf8",
    env: childEnv,
  });
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("clean product source passes with a valid owned Exo lease and task manifest", () => {
  const fixture = createFixture();
  const result = runClassifier(fixture);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /clean product source; validated/);
});

test("live owner-process ancestry identifies the session when actor environment markers are absent", () => {
  const fixture = createFixture();
  const result = runClassifier(fixture, [], {}, true);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /clean product source; validated/);
});

test("uncommitted product-source changes fail even beside valid Exo metadata", () => {
  const fixture = createFixture();
  mkdirSync(path.join(fixture.root, "src"), { recursive: true });
  writeFileSync(path.join(fixture.root, "src", "foreign-change.ts"), "export {}\n");
  const result = runClassifier(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /uncommitted path is not valid owned task metadata: src\/foreign-change\.ts/);
});

test("a second active owner of the same task/worktree fails closed", () => {
  const fixture = createFixture();
  writeJson(fixture.root, ".exo/cache/sessions/agent-claude.active.json", {
    actor: "agent:claude",
    git_branch: fixture.branch,
    git_head_sha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim(),
    ticket_id: fixture.ticketId,
    mode: "work",
    role: "implementation",
    pid: process.pid,
  });
  const result = runClassifier(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /multiple active Exo sessions exist in this worktree/);
});

test("expired Exo lock produces an actionable failure without deleting ownership evidence", () => {
  const fixture = createFixture();
  const expired = new Date(Date.now() - 60 * 1000).toISOString();
  const lock = { ...fixture.lock, expires_at: expired, lease_expires_at: expired };
  writeJson(fixture.root, ".exo/locks/ticket.lock.json", lock);
  const activePath = path.join(fixture.root, ".exo/cache/sessions/agent-codex.active.json");
  const active = JSON.parse(readFileSync(activePath, "utf8"));
  active.lock = lock;
  writeJson(fixture.root, ".exo/cache/sessions/agent-codex.active.json", active);
  const result = runClassifier(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Exo ticket lock expired/);
  assert.match(result.stderr, /exo session-scan.*exo session-cleanup/);
  assert.equal(existsSync(activePath), true);
});

test("unknown Exo files, invalid provenance, and dirty-skip arguments cannot bypass classification", () => {
  const fixture = createFixture();
  writeFileSync(path.join(fixture.root, ".exo", "unowned-note.txt"), "not an ownership record\n");
  const result = runClassifier(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /uncommitted path is not valid owned task metadata: \.exo\/unowned-note\.txt/);

  const bypass = runClassifier(fixture, ["--ignore-dirty"]);
  assert.notEqual(bypass.status, 0);
  assert.match(bypass.stderr, /unsupported argument: --ignore-dirty/);
});

test("mismatched task provenance is rejected", () => {
  const fixture = createFixture();
  const manifestPath = path.join(fixture.root, ".agent-session/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.branch = "chore/task-someone-elses-branch";
  writeJson(fixture.root, ".agent-session/manifest.json", manifest);
  const result = runClassifier(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /agent-session manifest does not match this task worktree/);
});
