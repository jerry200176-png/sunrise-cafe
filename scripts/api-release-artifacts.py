#!/usr/bin/env python3
"""Disabled GitHub artifact verifier; transport injection supports offline tests.

No actual requests are sent while NETWORK_ENABLED is false. Redirect hosts must
be explicitly approved before activation; access tokens never go to the archive.
"""
import hashlib
import importlib.util
import io
import json
import os
import base64
from pathlib import Path
import re
import selectors
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

spec = importlib.util.spec_from_file_location('write_ahead', Path(__file__).with_name('api-release-write-ahead.py'))
w = importlib.util.module_from_spec(spec); spec.loader.exec_module(w)
NETWORK_ENABLED = False
REPO = '/repos/jerry200176-png/sunrise-cafe'
MAX_ARCHIVE = 1024 * 1024
MAX_JSON = 4096
MAX_WORKER_OUTPUT = 2 * MAX_ARCHIVE
MAX_WORKER_INPUT = 65536


class InvalidEvidence(Exception):
    pass


def strict_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise InvalidEvidence('duplicate JSON field')
        value[key] = item
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def bounded_transport(request, timeout, approved_archive_hosts, opener):
    """Perform one bounded GET. Only the caller can manually follow a 302."""
    try:
        url = urllib.parse.urlsplit(request.full_url)
        if (request.get_method() != 'GET' or url.scheme != 'https' or not url.hostname
                or url.username or url.password or url.port not in (None, 443) or url.fragment):
            raise InvalidEvidence('invalid request destination')
        headers = {name.lower(): value for name, value in request.header_items()}
        auth = headers.get('authorization')
        if 'proxy-authorization' in headers:
            raise InvalidEvidence('proxy credentials are not allowed')
        if url.hostname == 'api.github.com':
            artifact = re.fullmatch(re.escape(REPO) + r'/actions/artifacts/[1-9][0-9]{0,19}(?:/zip)?', url.path)
            rules = url.path == REPO + '/rules/branches/main'
            git_commit = re.fullmatch(re.escape(REPO) + r'/git/commits/[a-f0-9]{40}', url.path)
            commit_data = re.fullmatch(re.escape(REPO) + r'/commits/[a-f0-9]{40}/(?:pulls|check-runs|status)', url.path)
            valid_query = ((not url.query and bool(artifact or git_commit))
                           or (url.query == 'per_page=100' and bool(commit_data or rules)))
            if (not valid_query or not isinstance(auth, str) or not auth.startswith('Bearer ')):
                raise InvalidEvidence('unauthorized GitHub API request')
        elif (url.hostname not in approved_archive_hosts or auth is not None
              or 'proxy-authorization' in headers):
            raise InvalidEvidence('unapproved or credentialed archive request')
        try:
            response = opener.open(request, timeout=timeout)
        except urllib.error.HTTPError as exc:
            # Redirects are returned to the caller, never followed automatically.
            if exc.code != 302:
                raise InvalidEvidence('upstream request failed') from None
            response = exc
        with response:
            status = response.status
            response_headers = dict(response.headers.items())
            data = bytearray()
            while len(data) <= MAX_ARCHIVE:
                part = response.read(min(65536, MAX_ARCHIVE + 1 - len(data)))
                if not part:
                    break
                data.extend(part)
            if len(data) > MAX_ARCHIVE:
                raise InvalidEvidence('artifact response exceeds limit')
            return status, response_headers, bytes(data)
    except InvalidEvidence:
        raise
    except Exception:
        raise InvalidEvidence('artifact transport failed') from None


def disabled_transport(request, timeout, approved_archive_hosts):
    if not NETWORK_ENABLED:
        raise InvalidEvidence('GitHub network access disabled')
    payload = {'url': request.full_url, 'headers': dict(request.header_items()),
               'hosts': sorted(approved_archive_hosts), 'timeout': timeout}
    raw = run_worker_with_deadline([sys.executable, '-B', '-I', str(Path(__file__).resolve()), '--artifact-worker'],
                                   json.dumps(payload).encode(), timeout)
    try:
        value = json.loads(raw)
        body = base64.b64decode(value['body'], validate=True)
        if len(body) > MAX_ARCHIVE:
            raise InvalidEvidence('artifact response exceeds limit')
        return value['status'], value['headers'], body
    except Exception:
        raise InvalidEvidence('artifact worker response invalid') from None


def run_worker_with_deadline(command, payload, timeout):
    """Bound output and time; kill/reap the worker on every unfinished exit."""
    process = None
    selector = None
    try:
        if not isinstance(payload, bytes) or len(payload) > MAX_WORKER_INPUT or not 0 < timeout <= 60:
            raise InvalidEvidence('invalid artifact worker limits')
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, env={})
        deadline = time.monotonic() + timeout
        selector = selectors.DefaultSelector()
        os.set_blocking(process.stdin.fileno(), False)
        os.set_blocking(process.stdout.fileno(), False)
        selector.register(process.stdout, selectors.EVENT_READ)
        if payload:
            selector.register(process.stdin, selectors.EVENT_WRITE)
        else:
            process.stdin.close()
        offset = 0
        output = bytearray()
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise InvalidEvidence('artifact request exceeded deadline')
            events = selector.select(remaining)
            if not events:
                raise InvalidEvidence('artifact request exceeded deadline')
            for key, _ in events:
                if key.fileobj is process.stdin:
                    written = os.write(process.stdin.fileno(), payload[offset:offset + 65536])
                    offset += written
                    if offset == len(payload):
                        selector.unregister(process.stdin)
                        process.stdin.close()
                else:
                    data = os.read(process.stdout.fileno(), min(65536, MAX_WORKER_OUTPUT + 1 - len(output)))
                    if not data:
                        selector.unregister(process.stdout)
                        process.stdout.close()
                    else:
                        output.extend(data)
                        if len(output) > MAX_WORKER_OUTPUT:
                            raise InvalidEvidence('artifact worker output exceeds limit')
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise InvalidEvidence('artifact request exceeded deadline')
        try:
            status = process.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            raise InvalidEvidence('artifact request exceeded deadline') from None
        if status != 0:
            raise InvalidEvidence('artifact worker failed')
        return bytes(output)
    except InvalidEvidence:
        raise
    except Exception:
        raise InvalidEvidence('artifact worker unavailable') from None
    finally:
        if selector is not None:
            selector.close()
        if process is not None:
            if process.poll() is None:
                try:
                    process.kill()
                except ProcessLookupError:
                    pass
            process.wait()
            if process.stdin and not process.stdin.closed:
                process.stdin.close()
            if process.stdout and not process.stdout.closed:
                process.stdout.close()


def artifact_worker():
    if not NETWORK_ENABLED:
        raise InvalidEvidence('GitHub network access disabled')
    payload = json.load(sys.stdin)
    request = urllib.request.Request(payload['url'], headers=payload['headers'], method='GET')
    status, headers, body = bounded_transport(request, payload['timeout'], frozenset(payload['hosts']),
                                               urllib.request.build_opener(NoRedirect))
    json.dump({'status': status, 'headers': headers, 'body': base64.b64encode(body).decode()}, sys.stdout)


class GitHubArtifacts:
    def __init__(self, token, approved_archive_hosts, transport=None):
        if not isinstance(token, str) or not token or '\n' in token or '\r' in token:
            raise ValueError('invalid GitHub token')
        self._token = token
        self.hosts = frozenset(approved_archive_hosts)
        if any(not isinstance(x, str) or not re.fullmatch(r'[a-z0-9.-]+', x) for x in self.hosts):
            raise ValueError('invalid archive host allowlist')
        self.transport = transport if transport is not None else lambda req, timeout: disabled_transport(req, timeout, self.hosts)

    def _request(self, url, authenticated):
        headers = {'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}
        if authenticated: headers['Authorization'] = 'Bearer ' + self._token
        request = urllib.request.Request(url, headers=headers, method='GET')
        try:
            status, response_headers, data = self.transport(request, 20)
            if not isinstance(data, bytes) or len(data) > MAX_ARCHIVE:
                raise InvalidEvidence('invalid response size')
            return status, response_headers, data
        except Exception:
            raise InvalidEvidence('artifact request failed') from None

    def fetch(self, artifact_id, run_id, attempt, sha, expected_digest, prefix='api-release-intent', *, intent=None):
        if (not isinstance(artifact_id, str) or not w.RUN.fullmatch(artifact_id)
                or not isinstance(run_id, str) or not w.RUN.fullmatch(run_id)
                or not isinstance(attempt, str) or not w.RUN.fullmatch(attempt)
                or not isinstance(sha, str) or not w.SHA.fullmatch(sha)
                or not isinstance(expected_digest, str) or not w.DIGEST.fullmatch(expected_digest)
                or prefix not in ('api-release-intent', 'api-release-candidate')):
            raise InvalidEvidence('invalid artifact request identity')
        base = 'https://api.github.com' + REPO + '/actions/artifacts/' + artifact_id
        status, _, body = self._request(base, True)
        if status != 200 or len(body) > MAX_JSON:
            raise InvalidEvidence('artifact metadata unavailable')
        try: meta = json.loads(body, object_pairs_hook=strict_object)
        except Exception: raise InvalidEvidence('invalid artifact metadata') from None
        run = meta.get('workflow_run') if isinstance(meta, dict) else None
        if (not isinstance(meta, dict) or type(meta.get('id')) is not int or str(meta['id']) != artifact_id
                or meta.get('name') != f'{prefix}-{run_id}-{attempt}' or meta.get('expired') is not False
                or not isinstance(run, dict) or type(run.get('id')) is not int or str(run['id']) != run_id
                or run.get('head_sha') != sha or meta.get('digest') != 'sha256:' + expected_digest.lower()):
            raise InvalidEvidence('artifact metadata does not match the expected run')
        status, headers, _ = self._request(base + '/zip', True)
        if status != 302 or not hasattr(headers, 'get'):
            raise InvalidEvidence('artifact redirect unavailable')
        location = headers.get('Location') or headers.get('location')
        if not isinstance(location, str): raise InvalidEvidence('artifact redirect missing')
        try:
            url = urllib.parse.urlsplit(location)
            invalid_url = (url.scheme != 'https' or not url.hostname or url.hostname not in self.hosts
                           or url.username or url.password or url.port not in (None, 443) or url.fragment)
        except ValueError:
            raise InvalidEvidence('invalid artifact redirect') from None
        if invalid_url:
            raise InvalidEvidence('artifact redirect host is not approved')
        status, _, archive = self._request(location, False)
        if status != 200 or hashlib.sha256(archive).hexdigest() != expected_digest.lower():
            raise InvalidEvidence('artifact archive digest mismatch')
        value = parse_archive(archive, 'intent.json' if prefix == 'api-release-intent' else 'candidate.json')
        try:
            if prefix == 'api-release-intent':
                w.validate(value)
                if value['run_id'] != run_id or value['attempt'] != attempt or value['commit'] != sha:
                    raise InvalidEvidence('intent payload does not match artifact run')
            else:
                validate_candidate(intent, value)
                if intent['run_id'] != run_id or intent['attempt'] != attempt or intent['commit'] != sha:
                    raise InvalidEvidence('candidate payload does not match artifact run')
        except ValueError:
            raise InvalidEvidence('invalid artifact payload') from None
        return value


def parse_archive(archive, expected_name):
    try:
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            entries = z.infolist()
            if len(entries) != 1 or entries[0].filename != expected_name or entries[0].file_size > MAX_JSON:
                raise InvalidEvidence('unexpected artifact contents')
            mode = entries[0].external_attr >> 16
            if stat.S_IFMT(mode) not in (0, stat.S_IFREG) or entries[0].is_dir():
                raise InvalidEvidence('artifact entry is not a regular file')
            with z.open(entries[0]) as stream: content = stream.read(MAX_JSON + 1)
            if len(content) > MAX_JSON: raise InvalidEvidence('artifact content too large')
            value = json.loads(content, object_pairs_hook=strict_object)
            if not isinstance(value, dict): raise InvalidEvidence('artifact content must be an object')
            return value
    except InvalidEvidence: raise
    except Exception: raise InvalidEvidence('invalid artifact archive') from None


def bind_candidate(intent, create_response, deployment):
    """Bind create result to independently retrieved project/Git deployment fields.

    A matching commit alone is insufficient. The caller must also authenticate
    the create-response record and connect it to this run via a verified artifact.
    """
    w.validate(intent)
    if not isinstance(create_response, dict) or not isinstance(deployment, dict):
        raise InvalidEvidence('invalid deployment evidence')
    candidate = create_response.get('id')
    source = deployment.get('gitSource')
    meta = deployment.get('meta')
    if (not isinstance(candidate, str) or not w.DEPLOYMENT.fullmatch(candidate)
            or deployment.get('id') != candidate or deployment.get('projectId') != w.PROJECT
            or deployment.get('target') != 'production' or not isinstance(source, dict)
            or source.get('type') != 'github' or source.get('org') != 'jerry200176-png'
            or source.get('repo') != 'sunrise-cafe' or source.get('ref') != 'main'
            or source.get('sha') != intent['commit'] or not isinstance(meta, dict)
            or meta.get('sunrise_run_id') != intent['run_id'] or meta.get('sunrise_run_attempt') != intent['attempt']
            or meta.get('sunrise_commit') != intent['commit']):
        raise InvalidEvidence('candidate identity mismatch')
    return {'version': 1, 'run_id': intent['run_id'], 'attempt': intent['attempt'],
            'commit': intent['commit'], 'baseline': intent['baseline'], 'candidate': candidate,
            'project': w.PROJECT}


def validate_candidate(intent, record):
    w.validate(intent)
    if not isinstance(record, dict) or set(record) != {'version', 'run_id', 'attempt', 'commit', 'baseline', 'candidate', 'project'}:
        raise InvalidEvidence('candidate record fields mismatch')
    if (type(record['version']) is not int or record['version'] != 1
            or any(record[k] != intent[k] for k in ('run_id', 'attempt', 'commit', 'baseline', 'project'))
            or not isinstance(record['candidate'], str) or not w.DEPLOYMENT.fullmatch(record['candidate'])):
        raise InvalidEvidence('candidate record identity mismatch')
    return record['candidate']


def authenticate_candidate(intent, record, deployment):
    """Recheck a run-bound create record against the latest deployment metadata."""
    candidate = validate_candidate(intent, record)
    expected = bind_candidate(intent, {'id': candidate}, deployment)
    if expected != record:
        raise InvalidEvidence('candidate record differs from deployment')
    return candidate


def persist_candidate(path, intent, create_response, deployment):
    """Write a run-bound candidate record exclusively for later artifact upload."""
    record = bind_candidate(intent, create_response, deployment)
    path = Path(path)
    if path.name != 'candidate.json':
        raise InvalidEvidence('unexpected candidate filename')
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
    parent = w.open_safe_directory(path.parent)
    try:
        descriptor = os.open(path.name, flags, 0o600, dir_fd=parent)
        with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
            json.dump(record, output, sort_keys=True, separators=(',', ':'))
            output.write('\n'); output.flush(); os.fsync(output.fileno())
        os.fsync(parent)
    finally:
        os.close(parent)
    return record


def persist_observation(path, intent, candidate):
    """Persist an untrusted list observation; never valid as candidate evidence."""
    w.validate(intent)
    if not isinstance(candidate, str) or not w.DEPLOYMENT.fullmatch(candidate):
        raise InvalidEvidence('invalid observed deployment')
    path = Path(path)
    if path.name != 'observed-candidate.json': raise InvalidEvidence('invalid observation filename')
    record = {'kind': 'untrusted-list-observation', 'run_id': intent['run_id'], 'attempt': intent['attempt'],
              'commit': intent['commit'], 'project': intent['project'], 'candidate': candidate}
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
    parent = w.open_safe_directory(path.parent)
    try:
        descriptor = os.open(path.name, flags, 0o600, dir_fd=parent)
        with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
            json.dump(record, output, sort_keys=True, separators=(',', ':'))
            output.write('\n'); output.flush(); os.fsync(output.fileno())
        os.fsync(parent)
    finally:
        os.close(parent)
    return record


def bind_remote_candidate(github, deployment_lookup, run_id, attempt, sha,
                          intent_artifact_id, intent_digest, candidate_artifact_id, candidate_digest):
    """Authenticate both run artifacts and recheck the candidate deployment.

    Artifact IDs and expected digests must come from trusted workflow outputs;
    a missing post-create artifact leaves ownership unknown.
    """
    intent = github.fetch(intent_artifact_id, run_id, attempt, sha, intent_digest)
    record = github.fetch(candidate_artifact_id, run_id, attempt, sha, candidate_digest,
                          prefix='api-release-candidate', intent=intent)
    deployment = deployment_lookup(record['candidate'])
    return intent, authenticate_candidate(intent, record, deployment)


if __name__ == '__main__':
    if sys.argv[1:] == ['--artifact-worker']:
        try:
            artifact_worker()
        except Exception:
            raise SystemExit(1) from None
    else:
        raise SystemExit('Artifact verification research is hard-stopped')
