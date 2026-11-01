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
    json.dump({'deployed': value.get('deployed'), 'commit': value.get('commit')}, sys.stdout)


def probe(api, deployment_id, expected_sha, *, deadline=None):
    """Check production alias version. Runtime does not expose deployment ID."""
    if not NETWORK_ENABLED: raise RuntimeError('health probe disabled')
    if expected_sha is None:
        source = api.deployment(deployment_id, deadline=deadline).get('gitSource') or {}
        expected_sha = source.get('sha')
    if not isinstance(expected_sha, str) or not artifacts.w.SHA.fullmatch(expected_sha):
        raise RuntimeError('health source SHA unavailable')
    timeout = 20 if deadline is None else min(20, deadline - time.monotonic())
    if timeout <= 0: raise RuntimeError('health deadline expired')
    raw = artifacts.run_worker_with_deadline([sys.executable, '-B', '-I', str(Path(__file__).resolve()), '--health-worker'], b'', timeout)
    try: result = json.loads(raw, object_pairs_hook=artifacts.strict_object)
    except Exception: raise RuntimeError('health response invalid') from None
    return result == {'deployed': 'v2', 'commit': expected_sha}


if __name__ == '__main__':
    if sys.argv[1:] == ['--health-worker']:
        try: worker()
        except Exception: raise SystemExit(1) from None
    else:
        raise SystemExit('health probe disabled')
