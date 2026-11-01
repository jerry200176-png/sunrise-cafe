#!/usr/bin/env python3
"""Loopback HTTP/HTTPS-only tests for bounded, non-redirecting transport."""
import contextlib
import http.server
import importlib.util
import io
import json
import pathlib
import shutil
import ssl
import subprocess
import tempfile
import threading
import time
import unittest
import sys
import urllib.parse
import urllib.request
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('artifacts', pathlib.Path(__file__).with_name('api-release-artifacts.py'))
a = importlib.util.module_from_spec(spec); spec.loader.exec_module(a)


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self):
        self.server.requests.append((self.path, self.headers.get('Authorization')))
        if self.path == '/small':
            self.send_response(200); self.end_headers(); self.wfile.write(b'ok'); return
        if self.path == '/slow':
            self.send_response(200); self.end_headers()
            for _ in range(60):
                try:
                    self.wfile.write(b'x'); self.wfile.flush(); time.sleep(0.05)
                except (BrokenPipeError, ConnectionResetError):
                    break
            return
        if self.path.endswith('/zip'):
            self.send_response(302); self.send_header('Location', '/must-not-follow'); self.end_headers()
            return
        if self.path == '/must-not-follow':
            self.send_response(500); self.end_headers(); return
        data = b'x' * (a.MAX_ARCHIVE + 1)
        self.send_response(200); self.send_header('Content-Length', str(len(data))); self.end_headers()
        with contextlib.suppress(BrokenPipeError, ConnectionResetError): self.wfile.write(data)


class LoopbackOpener:
    """Map synthetic trusted URLs to a local server; never contacts external hosts."""
    def __init__(self, scheme, port):
        self.scheme, self.port = scheme, port
        self.opener = urllib.request.build_opener(a.NoRedirect(), urllib.request.HTTPSHandler(context=ssl._create_unverified_context()))
    def open(self, request, timeout):
        parsed = urllib.parse.urlsplit(request.full_url)
        url = f'{self.scheme}://127.0.0.1:{self.port}' + parsed.path
        if parsed.query: url += '?' + parsed.query
        local = urllib.request.Request(url, headers=dict(request.header_items()), method='GET')
        return self.opener.open(local, timeout=timeout)


class Tests(unittest.TestCase):
    def exercise_server(self, scheme, context=None):
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.requests = []
        if context: server.socket = context.wrap_socket(server.socket, server_side=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            opener = LoopbackOpener(scheme, server.server_port)
            base = 'https://api.github.com' + a.REPO + '/actions/artifacts/456'
            def request(path): return urllib.request.Request(base + path, headers={'Authorization': 'Bearer synthetic'}, method='GET')
            status, headers, _ = a.bounded_transport(request('/zip'), 3, frozenset({'artifact.example'}), opener)
            self.assertEqual(status, 302); self.assertEqual(headers.get('Location'), '/must-not-follow')
            self.assertEqual(len(server.requests), 1)
            self.assertEqual(server.requests[0][1], 'Bearer synthetic')
            with self.assertRaises(a.InvalidEvidence): a.bounded_transport(request(''), 3, frozenset({'artifact.example'}), opener)
            self.assertEqual(len(server.requests), 2)
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=3)

    def test_loopback_http_rejects_redirect_and_large_stream(self): self.exercise_server('http')

    @unittest.skipUnless(shutil.which('openssl'), 'openssl unavailable')
    def test_loopback_https_rejects_redirect_and_large_stream(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-local-tls-') as tmp:
            key, cert = pathlib.Path(tmp) / 'key.pem', pathlib.Path(tmp) / 'cert.pem'
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                            '-subj', '/CN=localhost', '-keyout', str(key), '-out', str(cert)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=15)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); context.load_cert_chain(cert, key)
            self.exercise_server('https', context)

    def test_authorization_never_reaches_non_api_hosts(self):
        class NeverOpen:
            def open(self, *_args, **_kwargs): raise AssertionError('must fail before I/O')
        urls = ['https://attacker.example/x', 'https://artifact.example/x', 'http://api.github.com/x',
                'https://api.github.com/other/path']
        for url in urls:
            req = urllib.request.Request(url, headers={'Authorization': 'Bearer synthetic'})
            with self.subTest(url=url), self.assertRaises(a.InvalidEvidence):
                a.bounded_transport(req, 3, frozenset({'artifact.example'}), NeverOpen())

    def test_source_verification_paths_are_read_only_and_restricted(self):
        class Response(io.BytesIO):
            status = 200
            headers = {}
        class Fake:
            def open(self, req, timeout): return Response(b'{}')
        base = 'https://api.github.com' + a.REPO
        valid = [base + '/rules/branches/main?per_page=100', base + '/git/commits/' + 'a' * 40,
                 base + '/commits/' + 'a' * 40 + '/check-runs?per_page=100']
        for url in valid:
            req = urllib.request.Request(url, headers={'Authorization': 'Bearer synthetic'})
            self.assertEqual(a.bounded_transport(req, 3, frozenset(), Fake())[0], 200)
        bad = urllib.request.Request(base + '/commits/' + 'a' * 40 + '/check-runs?per_page=999',
                                     headers={'Authorization': 'Bearer synthetic'})
        with self.assertRaises(a.InvalidEvidence): a.bounded_transport(bad, 3, frozenset(), Fake())

    def test_non_authorized_archive_and_approved_host_only(self):
        class Response(io.BytesIO):
            status = 200
            headers = {}
        class Fake:
            def open(self, req, timeout): return Response(b'archive')
        req = urllib.request.Request('https://artifact.example/file?token=synthetic')
        self.assertEqual(a.bounded_transport(req, 3, frozenset({'artifact.example'}), Fake())[2], b'archive')
        with self.assertRaises(a.InvalidEvidence): a.bounded_transport(req, 3, frozenset(), Fake())

    def test_response_read_is_capped_and_exact_limit_is_allowed(self):
        class Response(io.BytesIO):
            status = 200
            headers = {}
        class Fake:
            def __init__(self, size): self.response = Response(b'x' * size)
            def open(self, req, timeout): return self.response
        req = urllib.request.Request('https://artifact.example/file')
        good = Fake(a.MAX_ARCHIVE)
        self.assertEqual(len(a.bounded_transport(req, 3, frozenset({'artifact.example'}), good)[2]), a.MAX_ARCHIVE)
        bad = Fake(a.MAX_ARCHIVE + 1024)
        with self.assertRaises(a.InvalidEvidence): a.bounded_transport(req, 3, frozenset({'artifact.example'}), bad)

    def test_worker_deadline_kills_slow_drip_stream(self):
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.requests = []
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            url = f'http://127.0.0.1:{server.server_port}/slow'
            code = 'import sys,urllib.request; urllib.request.urlopen(sys.argv[1],timeout=5).read()'
            start = time.monotonic()
            with self.assertRaises(a.InvalidEvidence):
                a.run_worker_with_deadline([sys.executable, '-I', '-c', code, url], b'', 0.4)
            self.assertLess(time.monotonic() - start, 2)
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=3)

    def test_direct_worker_cannot_enable_disabled_network(self):
        result = subprocess.run([sys.executable, '-B', '-I', 'scripts/api-release-artifacts.py', '--artifact-worker'],
                                input=b'{}', stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3)
        self.assertNotEqual(result.returncode, 0)

    def test_actual_artifact_worker_deadline_against_loopback_slow_drip(self):
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.requests = []
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            script = '''
import importlib.util, sys, urllib.request
spec = importlib.util.spec_from_file_location("artifact_under_test", sys.argv[1])
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
module.NETWORK_ENABLED = True
actual = urllib.request.build_opener(module.NoRedirect())
class Local:
    def open(self, req, timeout):
        local = urllib.request.Request("http://127.0.0.1:" + sys.argv[2] + "/slow", headers=dict(req.header_items()))
        return actual.open(local, timeout=timeout)
module.urllib.request.build_opener = lambda *_: Local()
module.artifact_worker()
'''
            payload = json.dumps({'url': 'https://api.github.com' + a.REPO + '/actions/artifacts/456',
                                  'headers': {'Authorization': 'Bearer synthetic'}, 'hosts': [], 'timeout': 5}).encode()
            command = [sys.executable, '-B', '-I', '-c', script, str(pathlib.Path(a.__file__).resolve()), str(server.server_port)]
            start = time.monotonic()
            with self.assertRaises(a.InvalidEvidence): a.run_worker_with_deadline(command, payload, 0.4)
            self.assertLess(time.monotonic() - start, 2)
            self.assertEqual(server.requests[0][1], 'Bearer synthetic')
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=3)

    def test_excess_output_kills_and_reaps_worker(self):
        command = [sys.executable, '-I', '-c',
                   'import sys,time;sys.stdout.buffer.write(b"x"*3000000);sys.stdout.flush();time.sleep(30)']
        spawned = []
        original = a.subprocess.Popen
        def spawn(*args, **kwargs):
            process = original(*args, **kwargs); spawned.append(process); return process
        with patch.object(a.subprocess, 'Popen', side_effect=spawn):
            with self.assertRaises(a.InvalidEvidence): a.run_worker_with_deadline(command, b'', 5)
        self.assertIsNotNone(spawned[0].poll())

    def test_unexpected_setup_error_still_kills_and_reaps_worker(self):
        command = [sys.executable, '-I', '-c', 'import time;time.sleep(30)']
        spawned = []
        original = a.subprocess.Popen
        def spawn(*args, **kwargs):
            process = original(*args, **kwargs); spawned.append(process); return process
        with patch.object(a.subprocess, 'Popen', side_effect=spawn), \
             patch.object(a.selectors, 'DefaultSelector', side_effect=RuntimeError('synthetic')):
            with self.assertRaises(a.InvalidEvidence): a.run_worker_with_deadline(command, b'', 5)
        self.assertIsNotNone(spawned[0].poll())

    def test_keyboard_interrupt_still_kills_and_reaps_worker(self):
        command = [sys.executable, '-I', '-c', 'import time;time.sleep(30)']
        spawned = []
        original = a.subprocess.Popen
        def spawn(*args, **kwargs):
            process = original(*args, **kwargs); spawned.append(process); return process
        with patch.object(a.subprocess, 'Popen', side_effect=spawn), \
             patch.object(a.selectors, 'DefaultSelector', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt): a.run_worker_with_deadline(command, b'', 5)
        self.assertIsNotNone(spawned[0].poll())

    def test_actual_artifact_worker_returns_bounded_local_response(self):
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.requests = []
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            script = '''
import importlib.util, sys, urllib.request
spec = importlib.util.spec_from_file_location("artifact_under_test", sys.argv[1])
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
module.NETWORK_ENABLED = True
actual = urllib.request.build_opener(module.NoRedirect())
class Local:
    def open(self, req, timeout):
        local = urllib.request.Request("http://127.0.0.1:" + sys.argv[2] + "/small", headers=dict(req.header_items()))
        return actual.open(local, timeout=timeout)
module.urllib.request.build_opener = lambda *_: Local()
module.artifact_worker()
'''
            payload = json.dumps({'url': 'https://api.github.com' + a.REPO + '/actions/artifacts/456',
                                  'headers': {'Authorization': 'Bearer synthetic'}, 'hosts': [], 'timeout': 3}).encode()
            command = [sys.executable, '-B', '-I', '-c', script, str(pathlib.Path(a.__file__).resolve()), str(server.server_port)]
            result = json.loads(a.run_worker_with_deadline(command, payload, 3))
            self.assertEqual(result['status'], 200)
            self.assertEqual(result['body'], 'b2s=')
            self.assertEqual(server.requests[0][1], 'Bearer synthetic')
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=3)


if __name__ == '__main__': unittest.main()
