#!/usr/bin/env python3
"""Disabled Vercel REST adapter. The workflow hard stop is also mandatory.

The documented request shapes are tested using only an injected transport.
Enabling network or wiring this into production requires independent review.
"""
import importlib.util
import base64
import json
import re
from pathlib import Path
import urllib.parse
import urllib.request
import sys
import time

spec = importlib.util.spec_from_file_location("api_release_model", Path(__file__).with_name("api-release-model.py"))
model = importlib.util.module_from_spec(spec)
spec.loader.exec_module(model)
spec2 = importlib.util.spec_from_file_location('release_artifacts', Path(__file__).with_name('api-release-artifacts.py'))
artifacts = importlib.util.module_from_spec(spec2); spec2.loader.exec_module(artifacts)

TEAM = "team_o4vau0vkVyakLaNFPmhXkL5M"
HOST = "sunrise-cafe-six.vercel.app"
NETWORK_ENABLED = False
MAX_RESPONSE = 1024 * 1024


class OutcomeUnknown(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise OutcomeUnknown("unexpected redirect")


def disabled_live_transport(request, timeout):
    if not NETWORK_ENABLED:
        raise OutcomeUnknown("network adapter is disabled")
    try:
        payload = {'url': request.full_url, 'method': request.get_method(),
                   'headers': dict(request.header_items()),
                   'body': base64.b64encode(request.data or b'').decode(), 'timeout': timeout}
        raw = artifacts.run_worker_with_deadline([sys.executable, '-B', '-I', str(Path(__file__).resolve()), '--vercel-worker'],
                                                  json.dumps(payload).encode(), timeout)
        value = json.loads(raw)
        body = base64.b64decode(value['body'], validate=True)
        if len(body) > MAX_RESPONSE: raise OutcomeUnknown('platform response too large')
        return value['status'], body
    except Exception:
        raise OutcomeUnknown("platform outcome unknown") from None


def worker():
    if not NETWORK_ENABLED: raise OutcomeUnknown('network adapter is disabled')
    payload = json.load(sys.stdin)
    url = urllib.parse.urlsplit(payload['url'])
    if (url.scheme != 'https' or url.hostname != 'api.vercel.com' or url.username or url.password
            or url.port not in (None, 443) or url.fragment):
        raise OutcomeUnknown('invalid platform destination')
    method = payload['method']
    allowed = ((method == 'POST' and url.path == '/v13/deployments')
               or (method == 'GET' and url.path == '/v4/aliases/' + HOST)
               or (method == 'GET' and re.fullmatch(r'/v13/deployments/dpl_[A-Za-z0-9]+', url.path))
               or (method == 'POST' and re.fullmatch(r'/v1/projects/' + re.escape(model.PROJECT) + r'/rollback/dpl_[A-Za-z0-9]+', url.path)))
    if not allowed: raise OutcomeUnknown('platform request not allowed')
    query = urllib.parse.parse_qs(url.query, keep_blank_values=True)
    expected_query = {'teamId': [TEAM]}
    if method == 'GET' and url.path.startswith('/v13/deployments/'):
        expected_query['withGitRepoInfo'] = ['true']
    if query != expected_query: raise OutcomeUnknown('platform scope mismatch')
    headers = payload['headers']
    if not isinstance(headers, dict) or not any(k.lower() == 'authorization' and v.startswith('Bearer ') for k, v in headers.items()):
        raise OutcomeUnknown('platform authorization unavailable')
    if any(k.lower() == 'proxy-authorization' for k in headers):
        raise OutcomeUnknown('proxy authorization not permitted')
    data = base64.b64decode(payload['body'], validate=True)
    request = urllib.request.Request(payload['url'], method=method, headers=headers, data=data if method == 'POST' else None)
    with urllib.request.build_opener(NoRedirect).open(request, timeout=payload['timeout']) as response:
        body = response.read(MAX_RESPONSE + 1)
        if len(body) > MAX_RESPONSE: raise OutcomeUnknown('platform response too large')
        json.dump({'status': response.status, 'body': base64.b64encode(body).decode()}, sys.stdout)


class VercelAPI:
    def __init__(self, token, transport=disabled_live_transport):
        if not isinstance(token, str) or not token or "\n" in token or "\r" in token:
            raise ValueError("platform credential unavailable")
        self._token = token
        self._transport = transport

    def _request(self, method, path, body=None, *, with_git=False, allow_empty=False, deadline=None):
        if method not in ("GET", "POST") or not path.startswith("/") or "?" in path or ".." in path:
            raise ValueError("unsupported platform request")
        query = {"teamId": TEAM}
        if with_git:
            query["withGitRepoInfo"] = "true"
        url = "https://api.vercel.com" + path + "?" + urllib.parse.urlencode(query)
        data = None if body is None else json.dumps(body, separators=(",", ":")).encode()
        request = urllib.request.Request(url, method=method, data=data,
            headers={"Authorization": "Bearer " + self._token, "Content-Type": "application/json", "Accept": "application/json"})
        try:
            timeout = 20 if deadline is None else min(20, deadline - time.monotonic())
            if timeout <= 0: raise OutcomeUnknown('platform deadline expired')
            status, raw = self._transport(request, timeout)
            if status < 200 or status >= 300 or not isinstance(raw, bytes) or len(raw) > MAX_RESPONSE:
                raise OutcomeUnknown("platform response unavailable")
            if allow_empty and raw == b"":
                return {}
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise OutcomeUnknown("invalid platform response")
            return result
        except Exception:
            raise OutcomeUnknown("platform outcome unknown") from None

    def create_preview(self, sha, ref):
        result = self._request("POST", "/v13/deployments", model.create_body(sha, ref))
        return self._deployment_id(result)

    def create_production(self, sha):
        result = self._request("POST", "/v13/deployments", model.create_body(sha, "main", True))
        return self._deployment_id(result)

    def production_alias(self, *, deadline=None):
        result = self._request("GET", "/v4/aliases/" + HOST, deadline=deadline)
        if result.get("projectId") != model.PROJECT:
            raise OutcomeUnknown("alias project not verified")
        return self._deployment_id({"id": result.get("deploymentId")})

    def rollback_request(self, deployment_id, *, deadline=None):
        # An accepted response alone does not prove traffic or health reverted.
        return self._request("POST", model.rollback_path(deployment_id), {}, allow_empty=True, deadline=deadline)

    def deployment(self, deployment_id, *, deadline=None):
        if not isinstance(deployment_id, str) or not model.ID.fullmatch(deployment_id):
            raise ValueError("invalid deployment identity")
        return self._request("GET", "/v13/deployments/" + deployment_id, with_git=True, deadline=deadline)

    @staticmethod
    def _deployment_id(result):
        value = result.get("id")
        if not isinstance(value, str) or not model.ID.fullmatch(value):
            raise OutcomeUnknown("deployment identity unavailable")
        return value


if __name__ == "__main__":
    if sys.argv[1:] == ['--vercel-worker']:
        try: worker()
        except Exception: raise SystemExit(1) from None
    else:
        raise SystemExit("Network adapter disabled and release hard-stopped")
