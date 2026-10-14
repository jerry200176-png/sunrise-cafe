#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

class PreflightError extends Error {}

function fail(message, recovery) {
  const detail = recovery ? `${message}; ${recovery}` : message;
  throw new PreflightError(detail);
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--cloud") {
      parsed.cloud = true;
      continue;
    }
    if (name !== "--root" && name !== "--branch") {
      fail(`unsupported argument: ${name}`);
    }
    const value = args[index + 1];
    if (!value) fail(`missing value for ${name}`);
    parsed[name.slice(2)] = value;
    index += 1;
  }
  if (!parsed.root || !parsed.branch) {
    fail("usage: agent-preflight-worktree.mjs --root <path> --branch <name>");
  }
  return parsed;
}

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function parseStatus(raw) {
  const fields = raw.split("\0");
  const entries = [];
  for (let index = 0; index < fields.length - 1; index += 1) {
    const record = fields[index];
    if (!record) continue;
    const status = record.slice(0, 2);
    const path = record.slice(3);
    if (status.includes("R") || status.includes("C")) {
      const previousPath = fields[index + 1];
      index += 1;
      entries.push({ status, path, previousPath, renameOrCopy: true });
    } else {
      entries.push({ status, path, renameOrCopy: false });
    }
  }
  return entries;
}

function readJson(path, description) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(`invalid ${description}: ${path}`);
  }
}

function readYamlField(path, field) {
  const source = readFileSync(path, "utf8");
  const line = source.split(/\r?\n/).find((item) => item.startsWith(`${field}:`));
  if (!line) return undefined;
  const raw = line.slice(field.length + 1).trim();
  if (raw === "null" || raw === "") return null;
  const quoted = raw.match(/^(?:"([^"]*)"|'([^']*)')\s*(?:#.*)?$/);
  return quoted ? quoted[1] ?? quoted[2] : raw.split(/\s+#/, 1)[0];
}

function validTicketId(value) {
  return typeof value === "string" && /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(value);
}

function isOwnerAncestor(ownerPid) {
  if (!Number.isInteger(ownerPid) || ownerPid <= 0) return false;
  let pid = process.pid;
  const visited = new Set();
  while (pid > 1 && !visited.has(pid)) {
    if (pid === ownerPid) return true;
    visited.add(pid);
    let stat;
    try {
      stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    } catch {
      return false;
    }
    const closeParen = stat.lastIndexOf(")");
    if (closeParen < 0) return false;
    const fields = stat.slice(closeParen + 1).trim().split(/\s+/);
    pid = Number(fields[1]);
  }
  return false;
}

function callerActor() {
  if (process.env.AGENT_ACTOR) return process.env.AGENT_ACTOR;
  if (process.env.EXO_ACTOR) return process.env.EXO_ACTOR;
  if (process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID) return "agent:codex";
  if (process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDECODE) return "agent:claude";
  return null;
}

function validateManifest(root, branch, cloud = false) {
  const path = join(root, ".agent-session", "manifest.json");
  const manifest = readJson(path, "agent-session manifest");
  const baseSha = manifest.base_sha;
  const validBase = typeof baseSha === "string"
    && /^[0-9a-f]{40}$/i.test(baseSha)
    && spawnGitAncestor(root, baseSha);
  const validRemote = typeof manifest.repo_remote === "string"
    && /(?:github\.com[:/])jerry200176-png\/sunrise-cafe(?:\.git)?$/.test(manifest.repo_remote);
  if (cloud) {
    // Cloud sessions have no worktree path; the manifest is bound to the session id instead
    // (check-agent-provenance.sh verifies every commit carries a matching Claude-Session trailer).
    const sessionId = process.env.CLAUDE_CODE_REMOTE_SESSION_ID || "";
    const urls = Array.isArray(manifest.session_urls) ? manifest.session_urls : [];
    if (
      manifest.schema_version !== "1.0"
      || manifest.provenance_type !== "agent-session-cloud"
      || manifest.project !== "sunrise"
      || !validTicketId(manifest.task_id)
      || manifest.branch !== branch
      || manifest.preflight_result !== "pass"
      || manifest.preflight_mode !== "cloud"
      || manifest.runner !== "claude-code-remote"
      || manifest.production_mutation !== false
      || manifest.session_id !== sessionId
      || !urls.some((url) => typeof url === "string" && url === `https://claude.ai/code/session_${sessionId.slice(4)}`)
      || !validRemote
      || !validBase
    ) {
      fail("agent-session-cloud manifest does not match this cloud session", "write the manifest for this session id and branch; never reuse another session's manifest");
    }
    return;
  }
  if (
    manifest.schema_version !== "1.0"
    || manifest.project !== "sunrise"
    || !validTicketId(manifest.task_id)
    || manifest.branch !== branch
    || resolve(manifest.worktree_path || "") !== root
    || manifest.preflight_result !== "pass"
    || manifest.production_mutation !== false
    || manifest.provenance_type !== "agent-session"
    || !manifest.session_id
    || !validRemote
    || !validBase
  ) {
    fail("agent-session manifest does not match this task worktree", "preserve its provenance and recreate the canonical task manifest through agent-start");
  }
}

function spawnGitAncestor(root, sha) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function validateExoSession(root, branch, sessionPath, sessions, cloud = false) {
  if (sessions.length !== 1) {
    fail("multiple active Exo sessions exist in this worktree", "use the owning session's worktree; do not release another agent's lock");
  }

  const session = sessions[0];
  const actor = callerActor();
  const actorFile = `${String(session.actor || "").replace(/^agent:/, "agent-")}.active.json`;
  if (sessionPath !== join(root, ".exo", "cache", "sessions", actorFile)) {
    fail("active Exo session filename does not match its recorded owner");
  }
  if (session.git_branch !== branch || (actor && session.actor !== actor)) {
    fail("active Exo session does not belong to this caller and branch", "continue only from the recorded owner session or use a separate agent-start worktree");
  }
  if (cloud) {
    // A cloud container hosts exactly one agent session, and each tool call runs in a fresh shell, so the
    // short-lived Exo CLI PID is never an ancestor. Ownership is the actor identity instead; lock, lease,
    // fencing, ticket and branch checks below still apply unchanged.
    if (!actor || session.actor !== actor) {
      fail("cloud mode: active Exo session actor does not match this agent", "start the Exo session as this agent (EXO_ACTOR) in this container");
    }
  } else if (!isOwnerAncestor(session.pid)) {
    fail(`active Exo owner PID ${session.pid} is not the caller's process ancestor`, "run preflight from the owning agent session; do not take over its worktree");
  }
  if (typeof session.git_head_sha !== "string" || !spawnGitAncestor(root, session.git_head_sha)) {
    fail("active Exo session head is not an ancestor of the current task HEAD", "reconcile the task branch through its owner before continuing");
  }
  if (!validTicketId(session.ticket_id) || session.mode !== "work" || session.role !== "implementation") {
    fail("active Exo session is not a valid implementation task");
  }

  const lock = session.lock;
  const lockPath = join(root, ".exo", "locks", "ticket.lock.json");
  const fencingPath = join(root, ".exo", "locks", "fencing.json");
  if (!lock || !existsSync(lockPath) || !existsSync(fencingPath)) {
    fail("active Exo session is missing its ticket lock or fencing record", "recover through the owning Exo session lifecycle; do not create or delete lock files manually");
  }
  const lockFile = readJson(lockPath, "Exo ticket lock");
  if (!isDeepStrictEqual(lock, lockFile) || lock.owner !== session.actor || lock.ticket_id !== session.ticket_id) {
    fail("Exo ticket lock does not match its active session", "reconcile with the recorded lock owner and fencing token before proceeding");
  }
  const expiry = Date.parse(lock.lease_expires_at || lock.expires_at || "");
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    fail(`Exo ticket lock expired at ${lock.lease_expires_at || lock.expires_at || "an invalid time"}`, "confirm the owner process has stopped, then run `exo session-scan` and `exo session-cleanup`; never delete the lock manually");
  }
  if (cloud) {
    // fencing.json is maintained by the local agent-start gateway, not by ExoProtocol itself, so in a cloud
    // container it only holds main's committed value. Require a valid token on the live lock instead.
    if (!Number.isInteger(lock.fencing_token) || lock.fencing_token < 1) {
      fail("cloud mode: Exo ticket lock has no valid fencing token", "reacquire the lock through the Exo session lifecycle");
    }
  } else {
    const fencing = readJson(fencingPath, "Exo fencing record");
    if (fencing.last_fencing_token !== lock.fencing_token) {
      fail("Exo fencing token is stale or inconsistent", "reacquire through the owning Exo session lifecycle after resolving the current lease");
    }
  }

  const ticketPath = join(root, ".exo", "tickets", `${session.ticket_id}.yaml`);
  if (!existsSync(ticketPath) || readYamlField(ticketPath, "id") !== session.ticket_id) {
    fail(`active Exo ticket ${session.ticket_id} is missing or has a mismatched id`);
  }
  const parentId = readYamlField(ticketPath, "parent_id");
  const allowed = new Set([
    relative(root, sessionPath),
    ".exo/locks/ticket.lock.json",
    ".exo/locks/fencing.json",
    relative(root, ticketPath),
  ]);
  if (parentId && parentId !== "null") {
    if (!validTicketId(parentId)) fail("active Exo ticket has an invalid parent ticket id");
    const parentPath = join(root, ".exo", "tickets", `${parentId}.yaml`);
    if (!existsSync(parentPath) || readYamlField(parentPath, "id") !== parentId) {
      fail(`parent Exo ticket ${parentId} is missing or has a mismatched id`);
    }
    allowed.add(relative(root, parentPath));
  }
  return allowed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = realpathSync(args.root);
  const top = realpathSync(git(root, ["rev-parse", "--show-toplevel"]).trim());
  if (top !== root) fail("requested root is not the Git worktree root");
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  if (branch !== args.branch) fail("caller branch changed during preflight");

  const entries = parseStatus(git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
  const changedPaths = entries.map((entry) => entry.path);
  if (entries.some((entry) => entry.renameOrCopy)) {
    fail("rename/copy changes are not accepted as task metadata");
  }

  const activeDir = join(root, ".exo", "cache", "sessions");
  const sessionPaths = existsSync(activeDir)
    ? readdirSync(activeDir)
      .filter((name) => name.endsWith(".active.json"))
      .map((name) => join(activeDir, name))
    : [];
  let metadataAllowed = new Set();
  if (sessionPaths.length > 0) {
    const sessions = sessionPaths.map((path) => readJson(path, "active Exo session"));
    if (sessions.some((session) => session.git_branch !== branch)) {
      fail("an active Exo session in this worktree names a different branch", "preserve the active session and recover using its owner; do not reuse this worktree");
    }
    metadataAllowed = validateExoSession(root, branch, sessionPaths[0], sessions, Boolean(args.cloud));
  } else if (args.cloud) {
    // Cloud work bypasses the agent-start gateway, so it must carry its own live Exo ticket lease.
    fail("cloud mode requires an active Exo session in this worktree", "run `EXO_ACTOR=agent:claude python3 -m exo.cli session-start --ticket-id <ticket> --acquire-lock` first");
  } else if (changedPaths.some((path) => path.startsWith(".exo/"))) {
    fail("Exo metadata changed without a live, matching owner session", "recreate or recover the task through agent-start and the Exo session lifecycle; do not ignore .exo changes");
  }

  if (args.cloud) {
    // Validate the cloud manifest even when it is already committed (a fresh cloud checkout is clean).
    validateManifest(root, branch, true);
    if (changedPaths.includes(".agent-session/manifest.json")) metadataAllowed.add(".agent-session/manifest.json");
  } else if (changedPaths.includes(".agent-session/manifest.json")) {
    validateManifest(root, branch, false);
    metadataAllowed.add(".agent-session/manifest.json");
  }

  for (const path of changedPaths) {
    if (metadataAllowed.has(path)) continue;
    fail(`uncommitted path is not valid owned task metadata: ${path}`, "resolve the product-source change within the ticket scope; no dirty-source bypass is available");
  }

  if (changedPaths.length === 0) {
    console.log("sunrise-preflight: OK: worktree clean");
  } else {
    console.log(`sunrise-preflight: OK: clean product source; validated ${changedPaths.length} owned metadata path(s)`);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`sunrise-preflight: FAIL: ${message}`);
  process.exitCode = 1;
}
