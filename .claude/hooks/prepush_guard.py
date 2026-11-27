#!/usr/bin/env python3
"""Claude Code PreToolUse hook (Bash). Two checks that used to be notes agents forgot:

1. Before `git push`: run scripts/agent-prepush.sh (fast CI checks) and deny the push when it fails.
2. Deny backticks inside an unquoted heredoc: the shell runs them and the words vanish from the text.

This hook runs BEFORE the command is approved, so it must not run text nobody reviewed. The list runs only:
- from this hook's own checkout, never a directory the command names;
- as the committed copy (HEAD), fed to bash on stdin, with no uncommitted or untracked file in the worktree;
- while the branch leaves scripts/ and node_modules as they are on main (a local commit is committed, not
  reviewed), so a PR that edits the checks gets CI only.
Every "cannot run it safely" case lets the push through and tells the agent why: CI is the real gate.
Known limits: the local origin/main ref and git-ignored files are trusted; this hook file itself is read from
the working tree, like every committed project hook.
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
TIMEOUT = 70  # seconds for the list; .claude/settings.json gives the hook 120
HDOC = re.compile(r"(?<!<)<<(-?)[ \t]*(['\"\\]?)([A-Za-z_]\w*)")
PUSH = re.compile(r"\bgit(?:\s+-[cC]\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+push\b(?![^\n;&|]*\s--dry-run\b)")
QUOTED = re.compile(r"'[^']*'|\"(?:\\.|[^\"\\])*\"")  # ponytail: crude; a push hidden in quotes is not checked


def out(**fields):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", **fields}}))
    sys.exit(0)


def deny(reason):
    out(permissionDecision="deny", permissionDecisionReason=reason)


def note(why):
    out(additionalContext=f"prepush_guard: pre-push checks not run ({why}); CI still checks")


def hdoc_ticks(cmd):
    """True when an unquoted heredoc body holds an unescaped backtick. One pass over the lines; a quoted
    heredoc's body is skipped, so a `<<` inside it starts nothing; no terminator line = not a heredoc."""
    lines = cmd.split("\n")
    last = {ln.lstrip("\t"): k for k, ln in enumerate(lines)}  # keeps the scan linear: no later line, no search
    i = 0
    while i < len(lines):
        m = HDOC.search(lines[i])
        i += 1
        if not m:
            continue
        strip = (lambda s: s.lstrip("\t")) if m[1] else (lambda s: s)
        end = next((k for k in range(i, len(lines)) if strip(lines[k]) == m[3]), None) if last.get(m[3], -1) >= i else None
        if end is None:
            continue
        if not m[2] and any(re.search(r"(?<!\\)`", ln) for ln in lines[i:end]):
            return True
        i = end + 1
    return False


def prepush(cmd):
    run = lambda *a, **k: subprocess.run(["git", *a], capture_output=True, text=True, timeout=5, **k)
    if os.path.realpath(run("rev-parse", "--show-toplevel").stdout.strip() or "/nonexistent") != ROOT:
        return
    top = ROOT  # every later git call runs here: pathspecs must not depend on the session's current folder
    git = lambda *a: run(*a, cwd=top).stdout.strip()
    body = git("show", "HEAD:scripts/agent-prepush.sh")
    if not body:
        return
    if re.search(r"(?:^|[\s;&|(])SKIP_PREPUSH=1(?=\s)", cmd):
        with open(os.path.join(git("rev-parse", "--path-format=absolute", "--git-common-dir"), "agent-prepush-skips.log"), "a") as fh:
            fh.write(f"{git('log', '-1', '--format=%cI %H')} {git('branch', '--show-current')}\n")
        note("SKIP_PREPUSH=1")
    if git("status", "--porcelain", "--untracked-files=all"):
        note("uncommitted or untracked files; commit, then run `git push` as its own command")
    base = git("merge-base", "origin/main", "HEAD")
    if not base or run("diff", "--quiet", base, "HEAD", "--", "scripts/", ":(glob)**/node_modules/**",
                       ":(glob)**/node_modules", cwd=top).returncode:
        note("this branch changes scripts/ (or commits node_modules) or has no origin/main; only checks already on main run here")
    r = subprocess.run(["bash", "-s"], input=body, cwd=top, capture_output=True, text=True, timeout=TIMEOUT)
    if r.returncode:
        deny("pre-push checks failed (scripts/agent-prepush.sh). Fix, commit, push again; skip once only if "
             "the check itself is broken: SKIP_PREPUSH=1 git push\n" + (r.stdout + r.stderr)[-1500:])


def main():
    try:
        cmd = (json.load(sys.stdin).get("tool_input") or {}).get("command", "") or ""
    except ValueError:
        return
    if hdoc_ticks(cmd):
        deny("backticks inside an unquoted heredoc: the shell runs them as commands and the words vanish from "
             "the text. Quote the delimiter (<<'EOF'), or write the text to a file and pass --body-file / -F. "
             "A command you really mean to run there: use $(...).")
    bare = QUOTED.sub("''", cmd)
    if PUSH.search(bare):
        try:
            prepush(cmd)
        except (OSError, subprocess.SubprocessError) as e:
            note(type(e).__name__)


if __name__ == "__main__":
    main()
