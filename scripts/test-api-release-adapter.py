#!/usr/bin/env python3
"""No-network request-contract tests for the disabled adapter."""
import importlib.util
import base64
import contextlib
import io
import json
import pathlib
import unittest
import urllib.error
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("api_release_adapter", pathlib.Path(__file__).with_name("api-release-adapter.py"))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
SHA = "a" * 40


class Tests(unittest.TestCase):
    def test_network_is_disabled_by_default(self):
        with self.assertRaises(a.OutcomeUnknown):
            a.VercelAPI("synthetic").create_production(SHA)
    def test_documented_requests_are_built_without_contacting_vercel(self):
        seen = []
        def fake(req, timeout):
            seen.append((req.method, req.full_url, json.loads(req.data) if req.data else None))
            if req.method == "GET": return 200, json.dumps({"projectId": a.model.PROJECT, "deploymentId": "dpl_base"}).encode()
            return 200, b'{"id":"dpl_new"}'
        api = a.VercelAPI("synthetic", fake)
        self.assertEqual(api.production_alias(), "dpl_base")
        self.assertEqual(api.create_preview(SHA, f"sunrise-release-probe/{SHA}-123"), "dpl_new")
        self.assertEqual(api.create_production(SHA), "dpl_new")
        api.rollback_request("dpl_base")
        self.assertTrue(all(url.startswith("https://api.vercel.com/") for _, url, _ in seen))
        self.assertNotIn("target", seen[1][2]); self.assertEqual(seen[2][2]["target"], "production")
        self.assertIn("/v1/projects/" + a.model.PROJECT + "/rollback/dpl_base?", seen[3][1])
        self.assertEqual(seen[2][2]["gitSource"]["sha"], SHA)
    def test_untrusted_response_fails_closed(self):
        for status, body in ((403, b'{}'), (200, b'null'), (200, b'{"id":null}'), (200, b'x' * (a.MAX_RESPONSE + 1))):
            with self.subTest(status=status, size=len(body)):
                api = a.VercelAPI("synthetic", lambda *_: (status, body))
                with self.assertRaises(a.OutcomeUnknown): api.create_production(SHA)
    def test_alias_must_identify_project(self):
        api = a.VercelAPI("synthetic", lambda *_: (200, b'{"projectId":"wrong","deploymentId":"dpl_base"}'))
        with self.assertRaises(a.OutcomeUnknown): api.production_alias()
    def test_redirect_is_rejected(self):
        with self.assertRaises(a.OutcomeUnknown):
            a.NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.com")
    def test_worker_restricts_host_path_and_team_with_synthetic_response(self):
        class Response(io.BytesIO):
            status = 200
        class Opener:
            def open(self, req, timeout):
                self_test.assertEqual(req.full_url, 'https://api.vercel.com/v13/deployments?teamId=' + a.TEAM)
                return Response(b'{"id":"dpl_new"}')
        self_test = self
        payload = {'url': 'https://api.vercel.com/v13/deployments?teamId=' + a.TEAM,
                   'method': 'POST', 'headers': {'Authorization': 'Bearer synthetic'},
                   'body': base64.b64encode(b'{}').decode(), 'timeout': 1}
        with patch.object(a, 'NETWORK_ENABLED', True), patch.object(a.urllib.request, 'build_opener', return_value=Opener()), \
             patch('sys.stdin', io.StringIO(json.dumps(payload))), contextlib.redirect_stdout(io.StringIO()) as out:
            a.worker()
            self.assertEqual(json.loads(out.getvalue())['status'], 200)
        for bad_url in ('https://attacker.example/v13/deployments?teamId=' + a.TEAM,
                        'https://api.vercel.com/v13/deployments?teamId=wrong'):
            with self.subTest(url=bad_url), patch.object(a, 'NETWORK_ENABLED', True), \
                 patch('sys.stdin', io.StringIO(json.dumps({**payload, 'url': bad_url}))):
                with self.assertRaises(a.OutcomeUnknown): a.worker()
    def test_request_timeout_is_capped_by_remaining_deadline(self):
        observed = []
        api = a.VercelAPI('synthetic', lambda req, timeout: (observed.append(timeout) or 200, b'{"id":"dpl_new"}'))
        with patch.object(a.time, 'monotonic', return_value=100):
            self.assertEqual(api.deployment('dpl_new', deadline=103)['id'], 'dpl_new')
            with self.assertRaises(a.OutcomeUnknown): api.deployment('dpl_new', deadline=100)
        self.assertEqual(observed, [3])


if __name__ == "__main__": unittest.main()
