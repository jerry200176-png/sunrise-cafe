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
Known limits: the local origin/main ref and git-ignored files are trusted.
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
TIMEOUT = 100  # seconds; .claude/settings.json gives the hook 120
HDOC_TICKS = re.compile(r"<<-?[ \t]*([A-Za-z_]\w*)(?!\w)[^\n]*\n(?:(?![ \t]*\1[ \t]*(?:\n|$)).*\n)*?"
                        r"(?![ \t]*\1[ \t]*(?:\n|$)).*(?<!\\)`")
QUOTED = re.compile(r"'[^']*'|\"(?:\\.|[^\"\\])*\"")  # ponytail: crude; a push hidden in quotes is not checked


def out(**fields):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", **fields}}))
    sys.exit(0)


def deny(reason):
    out(permissionDecision="deny", permissionDecisionReason=reason)


def note(why):
    out(additionalContext=f"prepush_guard: pre-push checks not run ({why}); CI still checks")


def prepush(cmd):
    git = lambda *a: subprocess.run(["git", *a], capture_output=True, text=True, timeout=5).stdout.strip()
    top = git("rev-parse", "--show-toplevel")
    if not top or os.path.realpath(top) != ROOT:
        return
    body = git("show", "HEAD:scripts/agent-prepush.sh")
    if not body:
        return
    if re.search(r"(?:^|[\s;&|(])SKIP_PREPUSH=1(?=\s)", cmd):
        with open(os.path.join(top, git("rev-parse", "--git-common-dir"), "agent-prepush-skips.log"), "a") as fh:
            fh.write(f"{git('log', '-1', '--format=%cI %H')} {git('branch', '--show-current')}\n")
        note("SKIP_PREPUSH=1")
    if git("status", "--porcelain", "--untracked-files=all"):
        note("uncommitted or untracked files; commit, then run `git push` as its own command")
    base = git("merge-base", "origin/main", "HEAD")
    if not base or subprocess.run(["git", "diff", "--quiet", base, "HEAD", "--", "scripts/", ":(glob)**/node_modules/**",
                                   ":(glob)**/node_modules"], capture_output=True, timeout=5).returncode:
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
    if HDOC_TICKS.search(cmd):
        deny("backticks inside an unquoted heredoc: the shell runs them as commands and the words vanish from "
             "the text. Quote the delimiter (<<'EOF'), or write the text to a file and pass --body-file / -F. "
             "A command you really mean to run there: use $(...).")
    bare = QUOTED.sub("''", cmd)
    if re.search(r"\bgit\b[^\n;&|]*\bpush\b", bare) and not re.search(r"\bpush\b[^\n;&|]*--dry-run\b", bare):
        try:
            prepush(cmd)
        except (OSError, subprocess.SubprocessError) as e:
            note(type(e).__name__)


if __name__ == "__main__":
    main()
