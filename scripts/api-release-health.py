#!/usr/bin/env python3
"""Guarded production version probe. No request is possible while disabled."""
import importlib.util
import json
from pathlib import Path
import sys
import time
import urllib.request

spec = importlib.util.spec_from_file_location('release_artifacts', Path(__file__).with_name('api-release-artifacts.py'))
artifacts = importlib.util.module_from_spec(spec); spec.loader.exec_module(artifacts)
NETWORK_ENABLED = False
HOST = 'sunrise-cafe-six.vercel.app'
MAX_BODY = 16384


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('unexpected health redirect')


def baseline_source(deployment, expected_id):
    """Classify provider Git source separately from untrusted CLI metadata.

    `source` itself is a best-effort provider label, not source attestation.
    """
    if not isinstance(deployment, dict) or not isinstance(expected_id, str) or not artifacts.w.DEPLOYMENT.fullmatch(expected_id):
        return 'unknown', None
    project = deployment.get('project')
    nested_project = project.get('id') if isinstance(project, dict) else None
    direct_project = deployment.get('projectId')
    if (deployment.get('id') != expected_id or deployment.get('target') != 'production'
            or deployment.get('readyState') != 'READY'
            or (direct_project is not None and direct_project != artifacts.w.PROJECT)
            or (nested_project is not None and nested_project != artifacts.w.PROJECT)
            or (direct_project != artifacts.w.PROJECT and nested_project != artifacts.w.PROJECT)):
        return 'unknown', None
    source = deployment.get('gitSource')
    meta = deployment.get('meta') if isinstance(deployment.get('meta'), dict) else {}
    if source is not None:
        if (not isinstance(source, dict) or source.get('type') != 'github'
                or source.get('org') != 'jerry200176-png' or source.get('repo') != 'sunrise-cafe'
                or source.get('ref') != 'main' or not isinstance(source.get('sha'), str)
                or not artifacts.w.SHA.fullmatch(source['sha'])):
            return 'unknown', None
        if ((meta.get('githubCommitSha') is not None and meta['githubCommitSha'] != source['sha'])
                or (meta.get('githubCommitRef') is not None and meta['githubCommitRef'] != source['ref'])):
            return 'unknown', None
        return 'provider-git-source', source['sha']
    sha, ref = meta.get('githubCommitSha'), meta.get('githubCommitRef')
    if isinstance(sha, str) and artifacts.w.SHA.fullmatch(sha) and ref == 'main':
        return 'unverified-metadata-only', sha
    return 'identity-only', None


def worker():
    if not NETWORK_ENABLED: raise RuntimeError('health probe disabled')
    opener = urllib.request.build_opener(NoRedirect)
    with opener.open(
        urllib.request.Request('https://' + HOST + '/api/version', headers={'Cache-Control': 'no-cache'}), timeout=15
    ) as response:
        if response.status != 200: raise RuntimeError('health status invalid')
        body = response.read(MAX_BODY + 1)
        if len(body) > MAX_BODY: raise RuntimeError('health response too large')
        value = json.loads(body, object_pairs_hook=artifacts.strict_object)
        if not isinstance(value, dict): raise RuntimeError('health response invalid')
    with opener.open(urllib.request.Request('https://' + HOST + '/', headers={'Cache-Control': 'no-cache'}), timeout=15) as homepage:
        if homepage.status != 200 or 'text/html' not in homepage.headers.get('Content-Type', '').lower():
            raise RuntimeError('homepage response invalid')
        if not homepage.read(4096): raise RuntimeError('homepage is empty')
    with opener.open(urllib.request.Request('https://' + HOST + '/api/booking-health', headers={'Cache-Control': 'no-cache'}), timeout=15) as booking:
        if booking.status != 200: raise RuntimeError('booking health status invalid')
        payload = booking.read(MAX_BODY + 1)
        if len(payload) > MAX_BODY: raise RuntimeError('booking health response too large')
        state = json.loads(payload, object_pairs_hook=artifacts.strict_object)
        if not isinstance(state, dict) or state.get('ok') is not True:
            raise RuntimeError('booking backend unhealthy')
    json.dump({'deployed': value.get('deployed'), 'commit': value.get('commit')}, sys.stdout)


def probe(api, deployment_id, expected_sha, *, deadline=None):
    """Check production alias version. Runtime does not expose deployment ID."""
    if not NETWORK_ENABLED: raise RuntimeError('health probe disabled')
    baseline_kind = None
    if expected_sha is None:
        baseline_kind, source_sha = baseline_source(api.deployment(deployment_id, deadline=deadline), deployment_id)
        if baseline_kind == 'unknown': raise RuntimeError('baseline deployment identity unavailable')
        # Metadata-only is not source proof; alias ID and health are checked
        # independently, without turning the self-reported SHA into an assertion.
        expected_sha = source_sha if baseline_kind == 'provider-git-source' else None
    if expected_sha is not None and (not isinstance(expected_sha, str) or not artifacts.w.SHA.fullmatch(expected_sha)):
        raise RuntimeError('health source SHA unavailable')
    if expected_sha is None and baseline_kind is None:
        raise RuntimeError('health source SHA unavailable')
    timeout = 20 if deadline is None else min(20, deadline - time.monotonic())
    if timeout <= 0: raise RuntimeError('health deadline expired')
    raw = artifacts.run_worker_with_deadline([sys.executable, '-B', '-I', str(Path(__file__).resolve()), '--health-worker'], b'', timeout)
    try: result = json.loads(raw, object_pairs_hook=artifacts.strict_object)
    except Exception: raise RuntimeError('health response invalid') from None
    if not isinstance(result, dict): return False
    commit = result.get('commit')
    if result.get('deployed') != 'v2' or not isinstance(commit, str) or not artifacts.w.SHA.fullmatch(commit):
        return False
    return expected_sha is None or commit == expected_sha


if __name__ == '__main__':
    if sys.argv[1:] == ['--health-worker']:
        try: worker()
        except Exception: raise SystemExit(1) from None
    else:
        raise SystemExit('health probe disabled')
