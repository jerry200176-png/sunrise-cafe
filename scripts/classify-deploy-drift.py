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


if __name__ == "__main__":
    result = classify(*sys.argv[1:]) if len(sys.argv) == 3 else "unknown"
    print(result)
    sys.exit(1 if result == "unknown" else 0)
