#!/usr/bin/env python3
"""Deploy reviewed main without database migrations; recover to prior deployment.

The provider and clock are injectable for offline tests. Production requests use
only fixed HTTPS hosts and never print response bodies or credentials.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

TEAM = 'team_o4vau0vkVyakLaNFPmhXkL5M'
PROJECT = 'prj_5swHVn2nqzrZ50VYx1zoEXZAvKiP'
HOST = 'sunrise-cafe-six.vercel.app'
REPO = '/repos/jerry200176-png/sunrise-cafe'
SHA = re.compile(r'[a-f0-9]{40}\Z')
DEPLOYMENT = re.compile(r'dpl_[A-Za-z0-9]+\Z')
MAX_BODY = 1024 * 1024
APPROVED_BASELINE = 'f2f40918a771fc2199178484b3f7e1c5b5e4f8b2'
CONTROL_FILES = frozenset({
    '.github/workflows/ci.yml', '.github/workflows/production-code-only.yml',
    '.github/workflows/production-deploy-migrate.yml', '.github/workflows/verify-production.yml',
    'docs/plans/2026-11-code-only-release.md', 'docs/plans/2026-11-production-identity-unknown.md',
    'scripts/code-only-manifest.json',
    'scripts/code-only-release.py', 'scripts/code-only-source.py',
    'scripts/production-identity.sh', 'scripts/production-identity-evaluate.py',
    'scripts/test_production_identity.py',
    'scripts/test_code_only_release.py', 'scripts/test_code_only_source.py',
    'scripts/verify-production-workflow-contract.mjs',
})
spec = importlib.util.spec_from_file_location('source', Path(__file__).with_name('code-only-source.py'))
source = importlib.util.module_from_spec(spec); spec.loader.exec_module(source)


class Unknown(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Unknown('redirect rejected')


class HTTP:
    def request(self, host, path, token=None, body=None, timeout=15, method=None):
        if host not in ('api.vercel.com', 'api.github.com', HOST) or not path.startswith('/'):
            raise Unknown('destination rejected')
        headers = {'Accept': 'application/json', 'Cache-Control': 'no-cache'}
        if token:
            if host == HOST or '\n' in token or '\r' in token:
                raise Unknown('invalid authentication destination')
            headers['Authorization'] = 'Bearer ' + token
        if host == 'api.github.com':
            headers['X-GitHub-Api-Version'] = '2022-11-28'
        data = None if body is None else json.dumps(body, separators=(',', ':')).encode()
        if data is not None: headers['Content-Type'] = 'application/json'
        if method not in (None, 'PATCH'): raise Unknown('method rejected')
        if method == 'PATCH' and (host != 'api.vercel.com' or not re.fullmatch(r'/v12/deployments/dpl_[A-Za-z0-9]+/cancel\?teamId=' + TEAM, path)):
            raise Unknown('cancel destination rejected')
        req = urllib.request.Request('https://' + host + path, data=data, headers=headers, method=method)
        try:
            # The workflow supplies its own credential; do not inherit proxy
            # settings that could receive it or redirect the API request.
            with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(req, timeout=timeout) as response:
                raw = response.read(MAX_BODY + 1)
                if len(raw) > MAX_BODY: raise Unknown('response too large')
                if not raw: return response.status, {}, b''
                try: value = json.loads(raw, object_pairs_hook=source.strict_object)
                except Exception: value = None
                return response.status, value, raw
        except Exception:
            raise Unknown('upstream request failed or outcome unknown') from None


class GitHub:
    def __init__(self, http, token): self.http, self.token = http, token
    def _request(self, url, authenticated):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != 'https' or parsed.hostname != 'api.github.com' or not parsed.path.startswith(REPO + '/'):
            raise Unknown('GitHub scope rejected')
        status, _, raw = self.http.request('api.github.com', parsed.path + ('?' + parsed.query if parsed.query else ''),
                                           self.token if authenticated else None)
        return status, {}, raw
    def main_sha(self):
        status, value, _ = self.http.request('api.github.com', REPO + '/git/ref/heads/main', self.token)
        obj = value.get('object') if isinstance(value, dict) else None
        sha = obj.get('sha') if isinstance(obj, dict) else None
        if status != 200 or not isinstance(sha, str) or not SHA.fullmatch(sha):
            raise Unknown('main identity unavailable')
        return sha


class Vercel:
    def __init__(self, http, token): self.http, self.token = http, token
    def request(self, path, body=None):
        status, result, _ = self.http.request('api.vercel.com', path + ('&' if '?' in path else '?') +
                                              urllib.parse.urlencode({'teamId': TEAM}), self.token, body)
        if not 200 <= status < 300 or not isinstance(result, dict): raise Unknown('Vercel response invalid')
        return result
    def alias(self):
        result = self.request('/v4/aliases/' + HOST)
        ident = result.get('deploymentId')
        if result.get('projectId') != PROJECT or not isinstance(ident, str) or not DEPLOYMENT.fullmatch(ident):
            raise Unknown('production alias identity unavailable')
        return ident
    def deployment(self, ident):
        if not isinstance(ident, str) or not DEPLOYMENT.fullmatch(ident): raise Unknown('invalid deployment')
        result = self.request('/v13/deployments/' + ident + '?withGitRepoInfo=true')
        if result.get('id') != ident or result.get('projectId') != PROJECT or result.get('target') != 'production':
            raise Unknown('deployment project mismatch')
        return result
    def create(self, sha):
        result = self.request('/v13/deployments', {'name': 'sunrise-cafe', 'project': PROJECT,
            'target': 'production', 'gitSource': {'type': 'github', 'org': 'jerry200176-png',
            'repo': 'sunrise-cafe', 'ref': 'main', 'sha': sha}})
        ident = result.get('id')
        if not isinstance(ident, str) or not DEPLOYMENT.fullmatch(ident): raise Unknown('deployment ID unavailable')
        return ident
    def rollback(self, ident):
        if not DEPLOYMENT.fullmatch(ident): raise Unknown('invalid rollback target')
        status, _, _ = self.http.request('api.vercel.com', '/v1/projects/' + PROJECT + '/rollback/' + ident +
                                         '?' + urllib.parse.urlencode({'teamId': TEAM}), self.token, {})
        if not 200 <= status < 300: raise Unknown('rollback not confirmed')
    def cancel(self, ident):
        if not isinstance(ident, str) or not DEPLOYMENT.fullmatch(ident): raise Unknown('invalid deployment')
        status, value, _ = self.http.request('api.vercel.com', '/v12/deployments/' + ident + '/cancel?' +
                                             urllib.parse.urlencode({'teamId': TEAM}), self.token, {}, method='PATCH')
        return status == 200 and isinstance(value, dict) and value.get('readyState') == 'CANCELED'


def health(http, expected):
    status, value, _ = http.request(HOST, '/api/version')
    if status != 200 or not isinstance(value, dict) or value.get('commit') != expected:
        return False
    status, _, html = http.request(HOST, '/')
    if status != 200 or not html: return False
    status, data, _ = http.request(HOST, '/api/booking-health')
    return status == 200 and isinstance(data, dict) and data.get('ok') is True


def same_source(deployment, sha):
    git = deployment.get('gitSource')
    if not isinstance(git, dict) or git.get('type') != 'github' or git.get('ref') != 'main' or git.get('sha') != sha:
        return False
    named = git.get('org') == 'jerry200176-png' and git.get('repo') == 'sunrise-cafe'
    identified = str(git.get('repoId', '')) == '1150036520'
    return named or identified


def verify_code_only(previous, sha, *, git=None, manifest_path=None):
    """Allow only the reviewed one-time application tree and release controls.

    This intentionally refuses any unlisted file, including migrations/schema.
    Further releases require a separately reviewed manifest and baseline.
    """
    if previous != APPROVED_BASELINE or not SHA.fullmatch(sha):
        raise Unknown('unexpected code-only baseline')
    if git is None:
        def git(*args):
            result = subprocess.run(['git', *args], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False)
            if result.returncode: raise Unknown('Git history unavailable')
            return result.stdout
    manifest_file = manifest_path or Path(__file__).with_name('code-only-manifest.json')
    try:
        manifest = json.loads(Path(manifest_file).read_text(), object_pairs_hook=source.strict_object)
        approved = manifest['approved_files']
        if manifest['baseline'] != APPROVED_BASELINE or not isinstance(approved, dict) or not approved:
            raise ValueError('invalid approved manifest')
        git('merge-base', '--is-ancestor', previous, sha)
        changes = git('diff', '--name-only', '--no-renames', '-z', previous, sha).decode('utf-8').split('\0')
        for path in filter(None, changes):
            if path not in approved and path not in CONTROL_FILES:
                raise ValueError('unreviewed file in code-only release')
        for path, blob in approved.items():
            if (not isinstance(path, str) or not isinstance(blob, str) or not SHA.fullmatch(blob)
                    or git('rev-parse', sha + ':' + path).decode().strip() != blob):
                raise ValueError('approved application file changed')
        # File mode is part of execution semantics; no symlinks or executable
        # substitutions are accepted for the reviewed application paths.
        for path in approved:
            entry = git('ls-tree', sha, '--', path).decode('utf-8').strip()
            if not entry.startswith('100644 blob '): raise ValueError('approved file mode changed')
    except Exception:
        raise Unknown('code-only manifest or source diff invalid') from None


def prepare(api, github, http, sha, tree):
    source.verify(github, sha, tree)
    if github.main_sha() != sha: raise Unknown('main has advanced')
    baseline = api.alias()
    deployment = api.deployment(baseline)
    status, value, _ = http.request(HOST, '/api/version')
    previous = value.get('commit') if isinstance(value, dict) else None
    if (deployment.get('readyState') != 'READY' or status != 200 or not isinstance(previous, str)
            or not SHA.fullmatch(previous) or not health(http, previous) or api.alias() != baseline):
        raise Unknown('production baseline is not verified')
    verify_code_only(previous, sha)
    return {'baseline': baseline, 'previous': previous, 'commit': sha}


def recover(api, http, record, candidate=None, *, clock=time.monotonic, sleep=time.sleep, seconds=3000):
    baseline, previous = record['baseline'], record['previous']
    deadline = clock() + seconds
    while clock() < deadline:
        try:
            current = api.alias()
            if current != baseline:
                # Commit metadata is not a unique create-response identity:
                # another writer can deploy the same SHA. Never roll it back.
                if candidate is None or current != candidate:
                    raise Unknown('production deployment ownership is unknown')
                state = api.deployment(current).get('readyState')
                # An in-flight deployment may later promote again after a
                # rollback. Do not claim recovery until its state is settled.
                if state not in ('READY', 'ERROR', 'CANCELED', 'CANCELLED'):
                    raise Unknown('candidate is live but still in flight; manual recovery required')
                api.rollback(baseline)
                if api.alias() == baseline and health(http, previous): return 'rolled-back'
                raise Unknown('rollback could not be verified')
            if candidate:
                state = api.deployment(candidate).get('readyState')
                if state in ('ERROR', 'CANCELED', 'CANCELLED') and health(http, previous): return 'baseline'
                if state in ('BUILDING', 'INITIALIZING', 'QUEUED'):
                    try:
                        if api.cancel(candidate) and api.alias() == baseline and health(http, previous):
                            return 'baseline'
                    except Exception:
                        # Cancellation may fail because the build raced to READY.
                        # Re-read the alias; do not guess whether it was cancelled.
                        pass
                    if api.alias() != baseline:
                        continue
        except Unknown:
            raise
        except Exception:
            raise Unknown('recovery unavailable') from None
        sleep(min(10, max(0, deadline - clock())))
    raise Unknown('deployment still in flight; immediate manual recovery may be required')


def create_candidate(api, record, *, on_candidate=lambda _value: None):
    baseline, sha = record['baseline'], record['commit']
    if api.alias() != baseline: raise Unknown('production baseline changed before deploy')
    candidate = api.create(sha)  # Never retry an unknown create response.
    on_candidate(candidate)
    return candidate


def verify_candidate(api, http, record, candidate, *, clock=time.monotonic, sleep=time.sleep, seconds=720):
    baseline, sha = record['baseline'], record['commit']
    deadline = clock() + seconds
    while clock() < deadline:
        deployment = api.deployment(candidate)
        state, live = deployment.get('readyState'), api.alias()
        if live not in (baseline, candidate): raise Unknown('production changed by another deployment')
        if state == 'READY' and live == candidate:
            # Vercel may not expose optional Git fields while still building.
            # They must be present and match before claiming a ready release.
            if not same_source(deployment, sha): raise Unknown('candidate source unverified')
            try: healthy = health(http, sha)
            except Exception: healthy = False
            if healthy and api.alias() == candidate: return candidate
            if api.alias() != candidate: raise Unknown('production changed before rollback')
            api.rollback(baseline)
            if api.alias() == baseline and health(http, record['previous']):
                raise Unknown('deployment verification failed; prior deployment restored')
            raise Unknown('deployment verification failed; rollback unconfirmed')
        if state in ('ERROR', 'CANCELED', 'CANCELLED'): raise Unknown('deployment did not become ready')
        sleep(min(5, max(0, deadline - clock())))
    raise Unknown('deployment still in flight; recovery required')


def read_record(path):
    value = json.loads(Path(path).read_text())
    if (not isinstance(value, dict) or set(value) != {'baseline', 'previous', 'commit'}
            or not isinstance(value['baseline'], str) or not DEPLOYMENT.fullmatch(value['baseline'])
            or any(not isinstance(value[x], str) or not SHA.fullmatch(value[x]) for x in ('previous', 'commit'))):
        raise Unknown('baseline record invalid')
    return value


def write_candidate(path, candidate, sha):
    if not isinstance(candidate, str) or not DEPLOYMENT.fullmatch(candidate) or not SHA.fullmatch(sha):
        raise Unknown('candidate identity invalid')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as output:
        json.dump({'deployment': candidate, 'commit': sha}, output)
        output.flush(); os.fsync(output.fileno())


def read_candidate(path, sha):
    if not Path(path).exists(): return None
    value = json.loads(Path(path).read_text())
    if (not isinstance(value, dict) or set(value) != {'deployment', 'commit'} or value['commit'] != sha
            or not isinstance(value['deployment'], str) or not DEPLOYMENT.fullmatch(value['deployment'])):
        raise Unknown('candidate record invalid')
    return value['deployment']


def output_candidate(path, candidate, sha):
    if not isinstance(candidate, str) or not DEPLOYMENT.fullmatch(candidate) or not SHA.fullmatch(sha):
        raise Unknown('candidate identity invalid')
    with open(path, 'a', encoding='utf-8') as output:
        output.write('candidate=' + candidate + '\ncandidate_commit=' + sha + '\n')
        output.flush(); os.fsync(output.fileno())


def recovery_candidate(path, sha, ident, commit):
    artifact = read_candidate(path, sha)
    if ident or commit:
        if not DEPLOYMENT.fullmatch(ident) or commit != sha:
            raise Unknown('candidate output invalid')
        if artifact and artifact != ident:
            raise Unknown('candidate identity sources disagree')
        return ident
    return artifact


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ('prepare', 'create', 'verify', 'recover'):
        raise SystemExit('invalid release phase')
    try:
        sha, ref = os.environ.get('GITHUB_SHA', ''), os.environ.get('GITHUB_REF', '')
        if not SHA.fullmatch(sha) or ref != 'refs/heads/main': raise Unknown('not a main release')
        token, gh_token = os.environ.get('VERCEL_TOKEN', ''), os.environ.get('GH_TOKEN', '')
        if not token or not gh_token: raise Unknown('required release credentials unavailable')
        http = HTTP(); api = Vercel(http, token); github = GitHub(http, gh_token)
        path = Path(os.environ['RUNNER_TEMP']) / 'sunrise-code-only-baseline.json'
        candidate_path = Path(os.environ['RUNNER_TEMP']) / 'sunrise-code-only-candidate.json'
        if sys.argv[1] == 'prepare':
            checked_out = subprocess.run(['git', 'rev-parse', 'HEAD'], check=True, capture_output=True, text=True).stdout.strip()
            if checked_out != sha: raise Unknown('checkout identity mismatch')
            tree = subprocess.run(['git', 'rev-parse', 'HEAD^{tree}'], check=True, capture_output=True, text=True).stdout.strip()
            record = prepare(api, github, http, sha, tree)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as output: json.dump(record, output); output.flush(); os.fsync(output.fileno())
        else:
            record = read_record(path)
            if record['commit'] != sha: raise Unknown('release record commit mismatch')
            if sys.argv[1] == 'create':
                if github.main_sha() != sha: raise Unknown('main has advanced')
                verify_code_only(record['previous'], sha)
                def retain(ident):
                    output_candidate(os.environ['GITHUB_OUTPUT'], ident, sha)
                    write_candidate(candidate_path, ident, sha)
                create_candidate(api, record, on_candidate=retain)
            elif sys.argv[1] == 'verify':
                candidate = read_candidate(candidate_path, sha)
                if candidate is None: raise Unknown('candidate record unavailable')
                verify_candidate(api, http, record, candidate)
            else:
                candidate = recovery_candidate(candidate_path, sha, os.environ.get('CANDIDATE_ID', ''),
                                               os.environ.get('CANDIDATE_COMMIT', ''))
                recover(api, http, record, candidate)
        print('Release phase complete:', sys.argv[1])
    except Exception:
        raise SystemExit('Release failed or outcome unknown; follow documented rollback procedure') from None


if __name__ == '__main__': main()
