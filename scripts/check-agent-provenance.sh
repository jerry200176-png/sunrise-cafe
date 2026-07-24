#!/usr/bin/env bash
# Validate Agent / human PR provenance for sunrise-cafe.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"
TASK_ROOT="/home/jerry/workspace/tasks/sunrise/"

fail() { echo "provenance: FAIL: $*" >&2; exit 1; }
ok() { echo "provenance: OK: $*"; }

# Dependabot cannot create an agent/human manifest. Trust the GitHub-managed
# actor only when its PR is strictly limited to npm dependency manifests.
# On synchronize/rebase events GITHUB_ACTOR may be the user who pushed the update.
# Use the immutable PR author as the trust signal, while keeping the changed-file
# allowlist narrow for both npm and Composer dependency PRs.
if [[ "${GITHUB_ACTOR:-}" == "dependabot[bot]" || "${PR_AUTHOR:-}" == "dependabot[bot]" ]]; then
  BASE_REF="${GITHUB_BASE_REF:-main}"
  mapfile -t CHANGED_FILES < <(git diff --name-only "origin/${BASE_REF}...HEAD")
  ((${#CHANGED_FILES[@]} > 0)) || fail "Dependabot PR has no changed files"
  for path in "${CHANGED_FILES[@]}"; do
    case "$path" in
      package.json|package-lock.json|npm-shrinkwrap.json|composer.json|composer.lock) ;;
      *) fail "Dependabot changed non-dependency file: $path" ;;
    esac
  done
  ok "GitHub Dependabot actor changed npm dependency manifests only"
  exit 0
fi

MANIFEST=""
if [[ -f .agent-session/manifest.json ]]; then
  MANIFEST=.agent-session/manifest.json
elif [[ -f .agent-session/human-authored.json ]]; then
  MANIFEST=.agent-session/human-authored.json
else
  fail "missing .agent-session/manifest.json or .agent-session/human-authored.json"
fi

python3 - "$MANIFEST" "$TASK_ROOT" <<'PY'
import json,sys,re,os,subprocess
path, task_root = sys.argv[1:3]
m=json.load(open(path))
ptype=m.get("provenance_type")
if ptype=="human-authored":
    for k in ("schema_version","provenance_type","declared_at"):
        if k not in m: raise SystemExit(f'human manifest missing {k}')
    if m["schema_version"]!="1.0": raise SystemExit('bad schema')
    blob=json.dumps(m)
    if re.search(r'(api[_-]?key|token|password|secret|BEGIN PRIVATE)', blob, re.I):
        raise SystemExit('sensitive data in human manifest')
    print('human-authored-ok')
    raise SystemExit(0)

if ptype!="agent-session":
    raise SystemExit('bad provenance_type')
required=["schema_version","session_id","project","task_id","repo_remote","base_sha",
          "branch","worktree_path","started_at","production_mutation","preflight_result","provenance_type"]
for k in required:
    if k not in m: raise SystemExit(f'missing {k}')
if m["project"]!="sunrise": raise SystemExit('project must be sunrise')
if m["preflight_result"]!="pass": raise SystemExit('preflight must pass')
if m["production_mutation"] is not False: raise SystemExit('production_mutation must be false')
if not re.match(r'^[0-9a-f]{40}$', m["base_sha"]): raise SystemExit('bad base_sha')
wp=m["worktree_path"]
if not wp.startswith(task_root):
    raise SystemExit(f'worktree_path not under {task_root}')
for bad in ("actions-runner","workspace-backups","/mnt/c/","/workspace/repos/","/workspace/sunrise-cafe"):
    if bad in wp:
        raise SystemExit(f'forbidden worktree {bad}')
branch=os.environ.get("GITHUB_HEAD_REF") or subprocess.check_output(["git","rev-parse","--abbrev-ref","HEAD"], text=True).strip()
if m["task_id"] not in branch:
    raise SystemExit(f'task_id {m["task_id"]} not in branch {branch}')
if m.get("branch") and m["branch"] != branch:
    raise SystemExit(f'manifest branch {m["branch"]} != git branch {branch}')
head=subprocess.check_output(["git","rev-parse","HEAD"], text=True).strip()
if subprocess.call(["git","merge-base","--is-ancestor", m["base_sha"], head])!=0:
    raise SystemExit('base_sha not ancestor of HEAD')
blob=json.dumps(m)
if re.search(r'(api[_-]?key|token|password|BEGIN PRIVATE)', blob, re.I):
    for k,v in m.items():
        if k=="production_mutation":
            continue
        if isinstance(v,str) and re.search(r'(api[_-]?key|token|password|BEGIN PRIVATE)', v, re.I):
            raise SystemExit(f'sensitive value in {k}')
print('agent-session-ok')
PY

ok "manifest=$MANIFEST validated"
exit 0
