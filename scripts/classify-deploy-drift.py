#!/usr/bin/env python3
"""Classify production/main drift using the existing Vercel ignore policy."""

import os
import re
import subprocess
import sys


def git(*args):
    return subprocess.run(["git", *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)


def classify(production, main):
    if not all(re.fullmatch(r"[0-9a-f]{40}", sha) for sha in (production, main)):
        return "unknown"
    if any(git("cat-file", "-e", f"{sha}^{{commit}}").returncode for sha in (production, main)):
        return "unknown"
    if production == main:
        return "exact"
    ancestor = git("merge-base", "--is-ancestor", production, main).returncode
    if ancestor == 1:
        return "actionable"
    if ancestor != 0:
        return "unknown"
    diff = git("diff", "--no-renames", "--name-only", "-z", production, main)
    if diff.returncode or any(b"\n" in path or b"\r" in path for path in diff.stdout.split(b"\0")):
        return "unknown"
    if not diff.stdout:
        return "benign"
    env = os.environ.copy()
    env.update({"VERCEL_ENV": "production", "VERCEL_GIT_PREVIOUS_SHA": production,
                "VERCEL_GIT_COMMIT_SHA": main, "GIT_CONFIG_COUNT": "1",
                "GIT_CONFIG_KEY_0": "diff.renames", "GIT_CONFIG_VALUE_0": "false"})
    result = subprocess.run(["bash", "scripts/vercel-ignored-build.sh"], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    return {0: "benign", 1: "actionable"}.get(result.returncode, "unknown")


def latest_actionable_time(production, main):
    """Find the most recent runtime change on the linear main history.

    If production is not on that first-parent chain, do not invent a grace
    period for an incomparable history: return 0 so the alert is actionable.
    """
    if classify(production, main) != "actionable":
        return None
    history = git("rev-list", "--first-parent", f"{production}..{main}")
    if history.returncode:
        return None
    commits = history.stdout.decode("ascii").splitlines()
    if not commits:
        return 0
    parent = git("rev-parse", "--verify", f"{commits[-1]}^")
    if parent.returncode:
        return None
    if parent.stdout.decode("ascii").strip() != production:
        return 0
    for commit in commits:
        parent = git("rev-parse", "--verify", f"{commit}^")
        if parent.returncode:
            return None
        verdict = classify(parent.stdout.decode("ascii").strip(), commit)
        if verdict == "unknown":
            return None
        if verdict == "actionable":
            timestamp = git("show", "-s", "--format=%ct", commit)
            value = timestamp.stdout.decode("ascii").strip()
            return int(value) if timestamp.returncode == 0 and value.isdigit() else None
    return None


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--latest-actionable":
        timestamp = latest_actionable_time(*sys.argv[2:])
        print("unknown" if timestamp is None else timestamp)
        sys.exit(1 if timestamp is None else 0)
    else:
        result = classify(*sys.argv[1:]) if len(sys.argv) == 3 else "unknown"
        print(result)
        sys.exit(1 if result == "unknown" else 0)
