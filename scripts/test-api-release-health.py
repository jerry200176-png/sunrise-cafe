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
    def test_probe_is_disabled_by_default(self):
        with self.assertRaises(RuntimeError): h.probe(None, 'dpl_fake', 'a' * 40)
    def test_worker_checks_json_and_size_using_fake_opener(self):
        class Opener:
            def __init__(self, body): self.body = body
            def open(self, req, timeout):
                self_test.assertIsNone(req.get_header('Authorization'))
                if req.full_url == 'https://' + h.HOST + '/': return Response(b'<html>synthetic</html>')
                self_test.assertEqual(req.full_url, 'https://' + h.HOST + '/api/version')
                return Response(self.body)
        self_test = self
        with patch.object(h, 'NETWORK_ENABLED', True), patch.object(h.urllib.request, 'build_opener', return_value=Opener(b'{"deployed":"v2","commit":"abc"}')):
            with contextlib.redirect_stdout(io.StringIO()) as output: h.worker()
            self.assertEqual(json.loads(output.getvalue()), {'deployed': 'v2', 'commit': 'abc'})
        with patch.object(h, 'NETWORK_ENABLED', True), patch.object(h.urllib.request, 'build_opener', return_value=Opener(b'x' * (h.MAX_BODY + 1))):
            with self.assertRaises(RuntimeError): h.worker()
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
