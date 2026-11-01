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
import urllib.parse
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("api_release_adapter", pathlib.Path(__file__).with_name("api-release-adapter.py"))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
SHA = "a" * 40


class Tests(unittest.TestCase):
    def test_network_is_disabled_by_default(self):
        with self.assertRaises(a.OutcomeUnknown):
            a.VercelAPI("synthetic").create_production(SHA, "123", "1")
    def test_documented_requests_are_built_without_contacting_vercel(self):
        seen = []
        def fake(req, timeout):
            seen.append((req.method, req.full_url, json.loads(req.data) if req.data else None))
            if req.method == "GET": return 200, json.dumps({"projectId": a.model.PROJECT, "deploymentId": "dpl_base"}).encode()
            return 200, b'{"id":"dpl_new"}'
        api = a.VercelAPI("synthetic", fake)
        self.assertEqual(api.production_alias(), "dpl_base")
        self.assertEqual(api.create_preview(SHA, f"sunrise-release-probe/{SHA}-123"), "dpl_new")
        self.assertEqual(api.create_production(SHA, "123", "1"), "dpl_new")
        api.rollback_request("dpl_base")
        self.assertTrue(all(url.startswith("https://api.vercel.com/") for _, url, _ in seen))
        self.assertNotIn("target", seen[1][2]); self.assertEqual(seen[2][2]["target"], "production")
        self.assertIn("/v1/projects/" + a.model.PROJECT + "/rollback/dpl_base?", seen[3][1])
        self.assertEqual(seen[2][2]["gitSource"]["sha"], SHA)
        self.assertEqual(seen[2][2]['meta'], {'sunrise_run_id': '123', 'sunrise_run_attempt': '1', 'sunrise_commit': SHA})
    def test_untrusted_response_fails_closed(self):
        for status, body in ((403, b'{}'), (200, b'null'), (200, b'{"id":null}'), (200, b'x' * (a.MAX_RESPONSE + 1))):
            with self.subTest(status=status, size=len(body)):
                api = a.VercelAPI("synthetic", lambda *_: (status, body))
                with self.assertRaises(a.OutcomeUnknown): api.create_production(SHA, "123", "1")
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
    def test_find_candidate_scans_all_pages_then_checks_deployment_identity(self):
        expected = {'sunrise_run_id': '123', 'sunrise_run_attempt': '1', 'sunrise_commit': SHA}
        item = {'uid': 'dpl_new', 'projectId': a.model.PROJECT, 'target': 'production', 'meta': expected}
        other = {'uid': 'dpl_old', 'projectId': a.model.PROJECT, 'target': 'production', 'meta': {'sunrise_run_id': '999'}}
        detail = {'id': 'dpl_new', 'projectId': a.model.PROJECT, 'target': 'production', 'meta': expected,
                  'gitSource': {'type': 'github', 'org': 'jerry200176-png', 'repo': 'sunrise-cafe', 'ref': 'main', 'sha': SHA}}
        calls = []
        def fake(req, timeout):
            url = urllib.parse.urlsplit(req.full_url); query = urllib.parse.parse_qs(url.query); calls.append((req.method, url.path, query))
            if url.path == '/v7/deployments':
                page = {'deployments': [other], 'pagination': {'next': 100}} if 'until' not in query else {'deployments': [item], 'pagination': {'next': None}}
                return 200, json.dumps(page).encode()
            return 200, json.dumps(detail).encode()
        api = a.VercelAPI('synthetic', fake)
        self.assertEqual(api.find_candidate(SHA, '123', '1')[0], 'dpl_new')
        self.assertEqual(len(calls), 3)
        self.assertTrue(all(method == 'GET' for method, _, _ in calls))
        self.assertEqual(calls[0][2]['projectId'], [a.model.PROJECT])
        self.assertEqual(calls[0][2]['sha'], [SHA]); self.assertEqual(calls[0][2]['branch'], ['main'])
    def test_find_candidate_fails_closed_on_zero_multiple_incomplete_or_denied(self):
        meta = {'sunrise_run_id': '123', 'sunrise_run_attempt': '1', 'sunrise_commit': SHA}
        item = {'uid': 'dpl_new', 'projectId': a.model.PROJECT, 'target': 'production', 'meta': meta}
        cases = [(200, {'deployments': [], 'pagination': {'next': None}}),
                 (200, {'deployments': [item, {**item, 'uid': 'dpl_other'}], 'pagination': {'next': None}}),
                 (200, {'deployments': [item], 'pagination': {}}),
                 (200, {'deployments': [{**item, 'projectId': 'wrong'}], 'pagination': {'next': None}}),
                 (403, {})]
        for status, body in cases:
            with self.subTest(status=status, body=body):
                api = a.VercelAPI('synthetic', lambda *_: (status, json.dumps(body).encode()))
                with self.assertRaises(a.OutcomeUnknown): api.find_candidate(SHA, '123', '1')
    def test_find_candidate_rejects_other_run_attempt_or_sha(self):
        meta = {'sunrise_run_id': '123', 'sunrise_run_attempt': '1', 'sunrise_commit': SHA}
        for key, value in [('sunrise_run_id', '124'), ('sunrise_run_attempt', '2'), ('sunrise_commit', 'b' * 40)]:
            entry = {'uid': 'dpl_new', 'projectId': a.model.PROJECT, 'target': 'production', 'meta': {**meta, key: value}}
            page = {'deployments': [entry], 'pagination': {'next': None}}
            with self.subTest(key=key), self.assertRaises(a.OutcomeUnknown):
                a.VercelAPI('synthetic', lambda *_: (200, json.dumps(page).encode())).find_candidate(SHA, '123', '1')
    def test_find_candidate_rejects_looping_cursor_and_wrong_detail(self):
        meta = {'sunrise_run_id': '123', 'sunrise_run_attempt': '1', 'sunrise_commit': SHA}
        item = {'uid': 'dpl_new', 'projectId': a.model.PROJECT, 'target': 'production', 'meta': meta}
        api = a.VercelAPI('synthetic', lambda *_: (200, json.dumps({'deployments': [], 'pagination': {'next': 100}}).encode()))
        with self.assertRaises(a.OutcomeUnknown): api.find_candidate(SHA, '123', '1')
        def fake(req, timeout):
            if urllib.parse.urlsplit(req.full_url).path == '/v7/deployments':
                return 200, json.dumps({'deployments': [item], 'pagination': {'next': None}}).encode()
            return 200, json.dumps({'id': 'dpl_new', 'projectId': a.model.PROJECT, 'target': 'production', 'meta': meta,
                                    'gitSource': {'type': 'github', 'org': 'jerry200176-png', 'repo': 'sunrise-cafe', 'ref': 'other', 'sha': SHA}}).encode()
        with self.assertRaises(a.OutcomeUnknown): a.VercelAPI('synthetic', fake).find_candidate(SHA, '123', '1')
    def test_find_candidate_detects_second_match_on_later_page(self):
        meta = {'sunrise_run_id': '123', 'sunrise_run_attempt': '1', 'sunrise_commit': SHA}
        def fake(req, timeout):
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(req.full_url).query)
            item = {'uid': 'dpl_second' if 'until' in query else 'dpl_first',
                    'projectId': a.model.PROJECT, 'target': 'production', 'meta': meta}
            return 200, json.dumps({'deployments': [item], 'pagination': {'next': None if 'until' in query else 100}}).encode()
        with self.assertRaises(a.OutcomeUnknown): a.VercelAPI('synthetic', fake).find_candidate(SHA, '123', '1')
    def test_list_worker_restricts_project_sha_branch_and_pagination(self):
        class Response(io.BytesIO): status = 200
        class Opener:
            def open(self, req, timeout): return Response(b'{"deployments":[],"pagination":{"next":null}}')
        query = {'teamId': a.TEAM, 'projectId': a.model.PROJECT, 'target': 'production',
                 'branch': 'main', 'sha': SHA, 'limit': '100', 'until': '100'}
        payload = {'url': 'https://api.vercel.com/v7/deployments?' + urllib.parse.urlencode(query),
                   'method': 'GET', 'headers': {'Authorization': 'Bearer synthetic'}, 'body': '', 'timeout': 1}
        with patch.object(a, 'NETWORK_ENABLED', True), patch.object(a.urllib.request, 'build_opener', return_value=Opener()), \
             patch('sys.stdin', io.StringIO(json.dumps(payload))), contextlib.redirect_stdout(io.StringIO()):
            a.worker()
        rollback_query = {'teamId': a.TEAM, 'projectId': a.model.PROJECT, 'target': 'production',
                          'rollbackCandidate': 'true', 'limit': '100'}
        with patch.object(a, 'NETWORK_ENABLED', True), patch.object(a.urllib.request, 'build_opener', return_value=Opener()), \
             patch('sys.stdin', io.StringIO(json.dumps({**payload, 'url': 'https://api.vercel.com/v7/deployments?' + urllib.parse.urlencode(rollback_query)}))), \
             contextlib.redirect_stdout(io.StringIO()):
            a.worker()
        for key, value in [('projectId', 'wrong'), ('sha', 'bad'), ('branch', 'other'), ('until', '0')]:
            bad = {**query, key: value}
            with self.subTest(key=key), patch.object(a, 'NETWORK_ENABLED', True), \
                 patch('sys.stdin', io.StringIO(json.dumps({**payload, 'url': 'https://api.vercel.com/v7/deployments?' + urllib.parse.urlencode(bad)}))):
                with self.assertRaises(a.OutcomeUnknown): a.worker()
    def test_rollback_candidate_requires_matching_project_target_and_flag(self):
        entry = {'uid': 'dpl_base', 'projectId': a.model.PROJECT, 'target': 'production', 'isRollbackCandidate': True}
        def client(item):
            page = {'deployments': [item], 'pagination': {'next': None}}
            return a.VercelAPI('synthetic', lambda *_: (200, json.dumps(page).encode()))
        self.assertTrue(client(entry).rollback_candidate('dpl_base'))
        without_project = {key: value for key, value in entry.items() if key != 'projectId'}
        self.assertTrue(client(without_project).rollback_candidate('dpl_base'))
        self.assertFalse(client({**entry, 'uid': 'dpl_other'}).rollback_candidate('dpl_base'))
        for bad in ({**entry, 'projectId': 'wrong'}, {**entry, 'target': 'preview'}, {**entry, 'isRollbackCandidate': False}):
            with self.subTest(bad=bad), self.assertRaises(a.OutcomeUnknown): client(bad).rollback_candidate('dpl_base')


if __name__ == "__main__": unittest.main()
