#!/usr/bin/env bash
# Fast pre-push checks (seconds, no npm install): the CI steps that most often cost a round and need no
# node_modules. .claude/hooks/prepush_guard.py runs this list before every agent `git push`.
# Heavy steps (lint, vitest, typecheck, build, gitleaks) stay in CI. Add a new fast check here, not in the hook.
# Skip once, only when a check itself is broken: SKIP_PREPUSH=1 git push
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
base="$(git merge-base origin/main HEAD 2>/dev/null)" || { echo "agent-prepush: skip (no origin/main; git fetch origin main)"; exit 0; }
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
fail=0
bad() { echo "FAIL  $1"; tail -n 25 <"$log"; fail=1; }

python3 -B scripts/check-rulebook.py >"$log" 2>&1 || bad rulebook
node scripts/check-additive-sql.mjs --base "$base" >"$log" 2>&1 || bad 'additive-sql (F1: Founder label founder-approved-sql)'
node scripts/run-production-migration-phase.mjs --check >"$log" 2>&1 || bad migration-plan
bash scripts/verify-migrations.sh >"$log" 2>&1 || bad verify-migrations
node scripts/verify-production-workflow-contract.mjs >"$log" 2>&1 || bad production-workflow-contract
node scripts/check-actions-pinned.mjs >"$log" 2>&1 || bad actions-pinned
# Same check as CI's last step and the release after merge: scripts/code-only-manifest.json must list this PR.
python3 -B -I -c "import importlib.util as u,subprocess as p;s=u.spec_from_file_location('r','scripts/code-only-release.py');r=u.module_from_spec(s);s.loader.exec_module(r);r.verify_code_only(r.APPROVED_BASELINE,p.run(['git','rev-parse','HEAD'],capture_output=True,text=True,check=True).stdout.strip())" >"$log" 2>&1 \
  || bad 'release approval list (update scripts/code-only-manifest.json, or merge main)'

[ "$fail" = 0 ] || { echo "agent-prepush: fix the FAIL lines above, commit, push again."; exit 1; }
echo "agent-prepush: OK"
