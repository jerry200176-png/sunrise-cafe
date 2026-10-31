#!/usr/bin/env python3
"""Check (or re-vendor) the portfolio rulebook in a repository. Stdlib only.

Vendor this file unchanged as scripts/check-rulebook.py in each governed repo.

  python3 scripts/check-rulebook.py             # offline: hash pin, adapters, stale phrases
  python3 scripts/check-rulebook.py --remote    # also compare with the pinned source commit
  python3 scripts/check-rulebook.py --update SHA  # re-vendor RULEBOOK.md at a portfolio-ops SHA

governance/RULEBOOK.lock: key=value lines source_repo, source_ref (40-hex or "self"), sha256,
optional max_always_loaded_lines (default 300), and optional repeated scan_include= / scan_exclude= globs.
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import re
import sys
import urllib.request
from pathlib import Path

RULEBOOK = "governance/RULEBOOK.md"
LOCK = "governance/RULEBOOK.lock"
DEFAULT_INCLUDE = ["CLAUDE.md", "AGENTS.md", "**/AGENTS.md", "governance/**/*.md",
                   ".claude/**/*.md", ".cursor/rules/**/*.mdc", "docs/sop/**/*.md"]
DEFAULT_EXCLUDE = [RULEBOOK, "governance/DECISIONS.md", "governance/decisions/**",
                   "node_modules/**", "**/node_modules/**", "vendor/**"]
RAW_URL = "https://raw.githubusercontent.com/{repo}/{ref}/" + RULEBOOK


def read_lock(root: Path) -> tuple[dict[str, str], list[str], list[str]]:
    keys: dict[str, str] = {}
    include, exclude = list(DEFAULT_INCLUDE), list(DEFAULT_EXCLUDE)
    for line in (root / LOCK).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = (part.strip() for part in line.split("=", 1))
        if key == "scan_include":
            include.append(value)
        elif key == "scan_exclude":
            exclude.append(value)
        else:
            keys[key] = value
    return keys, include, exclude


def stale_patterns(text: str) -> list[re.Pattern[str]]:
    block = re.search(r"^```stale-phrases\n(.*?)^```", text, re.M | re.S)
    lines = block.group(1).split("\n") if block else []
    return [re.compile(ln.strip().replace(" ", r"\s+"), re.I) for ln in lines if ln.strip()]


def scan_files(root: Path, include: list[str], exclude: list[str]) -> list[Path]:
    found = {p for pattern in include for p in root.glob(pattern) if p.is_file()}
    return sorted(p for p in found if not any(
        fnmatch.fnmatchcase(p.relative_to(root).as_posix(), g) for g in exclude))


def check(root: Path, remote: bool) -> list[str]:
    errors: list[str] = []
    rulebook = root / RULEBOOK
    if not rulebook.is_file() or not (root / LOCK).is_file():
        return [f"missing {RULEBOOK} or {LOCK}"]
    data = rulebook.read_bytes()
    keys, include, exclude = read_lock(root)
    if hashlib.sha256(data).hexdigest() != keys.get("sha256"):
        errors.append(f"{RULEBOOK} does not match the sha256 in {LOCK}; never hand-edit a "
                      "vendored copy (edit portfolio-ops, then --update)")
    ref = keys.get("source_ref", "")
    if ref != "self" and not re.fullmatch(r"[0-9a-f]{40}", ref):
        errors.append(f"{LOCK}: source_ref must be a 40-hex portfolio-ops commit or 'self'")
    elif remote and ref != "self":
        if fetch(keys.get("source_repo", ""), ref) != data:
            errors.append(f"{RULEBOOK} differs from {keys.get('source_repo')}@{ref}")
    text = (root / "CLAUDE.md").read_text(encoding="utf-8") if (root / "CLAUDE.md").is_file() else ""
    for imp in ("@AGENTS.md", "@" + RULEBOOK):
        if not re.search(rf"^{re.escape(imp)}\s*$", text, re.M):
            errors.append(f"CLAUDE.md must import {imp} on its own line")
    for imp in re.findall(r"^@(\S+)\s*$", text, re.M):
        if not (root / imp).is_file():
            errors.append(f"CLAUDE.md imports missing file {imp}")
    budget = int(keys.get("max_always_loaded_lines", "300"))
    loaded = sum(len((root / n).read_text(encoding="utf-8").splitlines())
                 for n in ("CLAUDE.md", "AGENTS.md", RULEBOOK) if (root / n).is_file())
    if loaded > budget:
        errors.append(f"CLAUDE.md + AGENTS.md + {RULEBOOK} = {loaded} lines > budget {budget} "
                      "(RULEBOOK K1): move procedures into skills")
    if (root / ".cursorrules").exists():
        errors.append(".cursorrules is retired; Cursor reads AGENTS.md")
    patterns = stale_patterns(data.decode("utf-8"))
    if not patterns:
        errors.append(f"{RULEBOOK} has no stale-phrases block")
    for path in scan_files(root, include, exclude):
        body = path.read_text(encoding="utf-8", errors="replace")
        for pat in patterns:
            for m in pat.finditer(body):
                line = body.count("\n", 0, m.start()) + 1
                errors.append(f"{path.relative_to(root)}:{line}: retired rule text "
                              f"'{pat.pattern}' (RULEBOOK section 11)")
    return errors


def fetch(repo: str, ref: str) -> bytes:
    with urllib.request.urlopen(RAW_URL.format(repo=repo, ref=ref), timeout=30) as resp:
        return resp.read()


def update(root: Path, ref: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{40}", ref):
        raise SystemExit("--update needs a full 40-hex portfolio-ops commit SHA")
    lock = root / LOCK
    lines = lock.read_text(encoding="utf-8").splitlines() if lock.is_file() else []
    keys, _, _ = read_lock(root) if lock.is_file() else ({}, [], [])
    repo = keys.get("source_repo", "jerry200176-png/portfolio-ops")
    data = fetch(repo, ref)
    (root / RULEBOOK).parent.mkdir(parents=True, exist_ok=True)
    (root / RULEBOOK).write_bytes(data)
    kept = [ln for ln in lines if ln.split("=", 1)[0].strip() not in
            {"source_repo", "source_ref", "sha256"}]
    head = [f"source_repo={repo}", f"source_ref={ref}",
            f"sha256={hashlib.sha256(data).hexdigest()}"]
    lock.write_text("\n".join(head + kept) + "\n", encoding="utf-8")
    print(f"vendored {RULEBOOK} from {repo}@{ref}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", default=".", type=Path)
    parser.add_argument("--remote", action="store_true")
    parser.add_argument("--update", metavar="SHA")
    args = parser.parse_args()
    root = args.root.resolve()
    if args.update:
        update(root, args.update)
    errors = check(root, args.remote)
    print("\n".join(f"check-rulebook: FAIL: {e}" for e in errors) or "check-rulebook: OK")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
