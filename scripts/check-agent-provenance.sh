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

if ptype=="agent-session-cloud":
    # Cloud agent sessions (Claude Code on the web/mobile) have no /home/jerry worktree.
    # Provenance is bound to the session identity carried by every commit instead of a path:
    # each non-merge commit in the PR must end with a `Claude-Session: <url>` trailer listed here.
    required=["schema_version","session_id","session_urls","project","task_id","repo_remote","base_sha",
              "branch","started_at","production_mutation","preflight_result","preflight_mode","runner"]
    for k in required:
        if k not in m: raise SystemExit(f'cloud manifest missing {k}')
    if m["schema_version"]!="1.0": raise SystemExit('bad schema')
    if m["project"]!="sunrise": raise SystemExit('project must be sunrise')
    if m["runner"]!="claude-code-remote": raise SystemExit('runner must be claude-code-remote')
    if m["preflight_mode"]!="cloud" or m["preflight_result"]!="pass": raise SystemExit('cloud preflight must pass')
    if m["production_mutation"] is not False: raise SystemExit('production_mutation must be false')
    if not re.match(r'^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$', m["task_id"]): raise SystemExit('bad task_id')
    if not re.match(r'^[0-9a-f]{40}$', m["base_sha"]): raise SystemExit('bad base_sha')
    if not re.search(r'github\.com[:/]jerry200176-png/sunrise-cafe(\.git)?$', m["repo_remote"]): raise SystemExit('bad repo_remote')
    urls=m["session_urls"]
    if not isinstance(urls,list) or not urls: raise SystemExit('session_urls must be a non-empty list')
    for u in urls:
        if not isinstance(u,str) or not re.match(r'^https://claude\.ai/code/session_[A-Za-z0-9]{8,}$', u):
            raise SystemExit(f'bad session url: {u!r}')
    sid=m["session_id"]
    if not isinstance(sid,str) or not re.match(r'^cse_[A-Za-z0-9]{8,}$', sid):
        raise SystemExit('session_id must be the remote session id (cse_...)')
    if not any(u.rsplit("session_",1)[1]==sid[len("cse_"):] for u in urls):
        raise SystemExit('session_id does not match any session url')
    branch=m["branch"]
    if m["task_id"] not in branch: raise SystemExit(f'task_id {m["task_id"]} not in manifest branch {branch}')
    ci_branch=os.environ.get("GITHUB_HEAD_REF")
    local_branch=subprocess.check_output(["git","rev-parse","--abbrev-ref","HEAD"], text=True).strip()
    if ci_branch:
        if branch!=ci_branch: raise SystemExit(f'manifest branch {branch} != GitHub PR branch {ci_branch}')
    elif branch!=local_branch:
        raise SystemExit(f'manifest branch {branch} != git branch {local_branch}')
    head=subprocess.check_output(["git","rev-parse","HEAD"], text=True).strip()
    if subprocess.call(["git","merge-base","--is-ancestor", m["base_sha"], head])!=0:
        raise SystemExit('base_sha not ancestor of HEAD')
    base_ref=os.environ.get("GITHUB_BASE_REF") or "main"
    range_start=subprocess.run(["git","merge-base",f"origin/{base_ref}",head],capture_output=True,text=True).stdout.strip() or m["base_sha"]
    log=subprocess.check_output(["git","log","--no-merges","--format=%H%x1f%(trailers:key=Claude-Session,valueonly,separator=%x1e)%x1d",
                                 f"{range_start}..{head}"], text=True)
    commits=[c.strip() for c in log.split("\x1d") if c.strip()]
    if not commits: raise SystemExit('no commits to attribute')
    allowed=set(urls)
    for c in commits:
        sha,_,trailers=c.partition("\x1f")
        values={v.strip() for v in trailers.split("\x1e") if v.strip()}
        if not values & allowed:
            raise SystemExit(f'commit {sha[:12]} has no Claude-Session trailer from session_urls')
    blob=json.dumps(m)
    if re.search(r'(api[_-]?key|token|password|secret|BEGIN PRIVATE)', blob, re.I):
        raise SystemExit('sensitive data in cloud manifest')
    print(f'agent-session-cloud-ok commits={len(commits)}')
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
ci_branch=os.environ.get("GITHUB_HEAD_REF")
local_branch=subprocess.check_output(["git","rev-parse","--abbrev-ref","HEAD"], text=True).strip()
manifest_branch=m["branch"]
if m["task_id"] not in manifest_branch:
    raise SystemExit(f'task_id {m["task_id"]} not in manifest branch {manifest_branch}')
if ci_branch:
    if manifest_branch != ci_branch:
        raise SystemExit(f'manifest branch {manifest_branch} != GitHub PR branch {ci_branch}')
elif m.get("local_branch", local_branch) != local_branch:
    raise SystemExit(f'manifest local_branch {m.get("local_branch")} != git branch {local_branch}')
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
