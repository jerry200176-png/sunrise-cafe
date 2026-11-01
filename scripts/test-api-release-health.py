#!/usr/bin/env python3
import contextlib
import importlib.util
import io
import json
import pathlib
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('health', pathlib.Path(__file__).with_name('api-release-health.py'))
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)


class Response(io.BytesIO):
    status = 200
    headers = {'Content-Type': 'text/html; charset=utf-8'}


class Tests(unittest.TestCase):
    def test_cli_metadata_alone_never_establishes_baseline_source(self):
        # Shape mirrors the non-secret fields returned by the current provider
        # connector: nested project, production READY, source label, meta only.
        baseline = {'id': 'dpl_base', 'project': {'id': h.artifacts.w.PROJECT}, 'target': 'production',
                    'readyState': 'READY', 'source': 'cli', 'meta': {'githubCommitSha': 'a' * 40, 'githubCommitRef': 'main'}}
        self.assertEqual(h.baseline_source(baseline, 'dpl_base'), ('unverified-metadata-only', 'a' * 40))
        class FakeAPI:
            def deployment(self, *_args, **_kwargs): return baseline
        # Operational health can be checked without promoting self-reported
        # metadata into verified source provenance.
        payload = b'{"deployed":"v2","commit":"' + b'b' * 40 + b'"}'
        with patch.object(h, 'NETWORK_ENABLED', True), patch.object(h.artifacts, 'run_worker_with_deadline', return_value=payload):
            self.assertTrue(h.probe(FakeAPI(), 'dpl_base', None))
        self.assertEqual(h.baseline_source(baseline, 'dpl_base')[0], 'unverified-metadata-only')

    def test_provider_git_source_requires_exact_project_repository_and_ref(self):
        source = {'type': 'github', 'org': 'jerry200176-png', 'repo': 'sunrise-cafe', 'ref': 'main', 'sha': 'a' * 40}
        baseline = {'id': 'dpl_base', 'projectId': h.artifacts.w.PROJECT, 'target': 'production',
                    'readyState': 'READY', 'gitSource': source}
        self.assertEqual(h.baseline_source(baseline, 'dpl_base'), ('provider-git-source', 'a' * 40))
        for bad in ({**baseline, 'projectId': 'wrong'}, {**baseline, 'target': 'preview'},
                    {**baseline, 'gitSource': {**source, 'repo': 'other'}},
                    {**baseline, 'gitSource': {**source, 'ref': 'other'}},
                    {**baseline, 'meta': {'githubCommitSha': 'b' * 40}}):
            with self.subTest(bad=bad): self.assertEqual(h.baseline_source(bad, 'dpl_base'), ('unknown', None))

    def test_conflicting_nested_project_or_wrong_deployment_fails_closed(self):
        baseline = {'id': 'dpl_base', 'projectId': h.artifacts.w.PROJECT, 'project': {'id': 'wrong'},
                    'target': 'production', 'readyState': 'READY',
                    'meta': {'githubCommitSha': 'a' * 40, 'githubCommitRef': 'main'}}
        self.assertEqual(h.baseline_source(baseline, 'dpl_base'), ('unknown', None))
        baseline['project'] = {'id': h.artifacts.w.PROJECT}
        self.assertEqual(h.baseline_source(baseline, 'dpl_other'), ('unknown', None))

    def test_probe_is_disabled_by_default(self):
        with self.assertRaises(RuntimeError): h.probe(None, 'dpl_fake', 'a' * 40)
    def test_worker_checks_json_and_size_using_fake_opener(self):
        class Opener:
            def __init__(self, body): self.body = body
            def open(self, req, timeout):
                self_test.assertIsNone(req.get_header('Authorization'))
                if req.full_url == 'https://' + h.HOST + '/': return Response(b'<html>synthetic</html>')
                if req.full_url == 'https://' + h.HOST + '/api/booking-health': return Response(b'{"ok":true}')
                self_test.assertEqual(req.full_url, 'https://' + h.HOST + '/api/version')
                return Response(self.body)
        self_test = self
        with patch.object(h, 'NETWORK_ENABLED', True), patch.object(h.urllib.request, 'build_opener', return_value=Opener(b'{"deployed":"v2","commit":"abc"}')):
            with contextlib.redirect_stdout(io.StringIO()) as output: h.worker()
            self.assertEqual(json.loads(output.getvalue()), {'deployed': 'v2', 'commit': 'abc'})
        with patch.object(h, 'NETWORK_ENABLED', True), patch.object(h.urllib.request, 'build_opener', return_value=Opener(b'x' * (h.MAX_BODY + 1))):
            with self.assertRaises(RuntimeError): h.worker()
    def test_worker_rejects_booking_backend_failure_without_echoing_data(self):
        class Opener:
            def open(self, req, timeout):
                if req.full_url.endswith('/api/version'): return Response(b'{"deployed":"v2","commit":"abc"}')
                if req.full_url.endswith('/api/booking-health'): return Response(b'{"ok":false,"error":"synthetic-private"}')
                return Response(b'<html>synthetic</html>')
        with patch.object(h, 'NETWORK_ENABLED', True), patch.object(h.urllib.request, 'build_opener', return_value=Opener()):
            with contextlib.redirect_stdout(io.StringIO()) as output:
                with self.assertRaises(RuntimeError): h.worker()
            self.assertNotIn('synthetic-private', output.getvalue())
    def test_probe_requires_expected_commit(self):
        with patch.object(h, 'NETWORK_ENABLED', True), patch.object(h.artifacts, 'run_worker_with_deadline', return_value=b'{"deployed":"v2","commit":"' + b'a' * 40 + b'"}'):
            self.assertTrue(h.probe(None, 'dpl_fake', 'a' * 40))
            self.assertFalse(h.probe(None, 'dpl_fake', 'b' * 40))
            with self.assertRaises(RuntimeError): h.probe(None, 'dpl_fake', 'bad')
    def test_health_worker_uses_remaining_deadline(self):
        body = b'{"deployed":"v2","commit":"' + b'a' * 40 + b'"}'
        with patch.object(h, 'NETWORK_ENABLED', True), patch.object(h.time, 'monotonic', return_value=100), \
             patch.object(h.artifacts, 'run_worker_with_deadline', return_value=body) as run:
            self.assertTrue(h.probe(None, 'dpl_fake', 'a' * 40, deadline=103))
            self.assertEqual(run.call_args.args[2], 3)
            with self.assertRaises(RuntimeError): h.probe(None, 'dpl_fake', 'a' * 40, deadline=100)


if __name__ == '__main__': unittest.main()
