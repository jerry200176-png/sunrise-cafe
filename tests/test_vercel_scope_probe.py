import contextlib
import io
import os
import re
import textwrap
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock


WORKFLOW = Path('.github/workflows/production-deploy-migrate.yml')
SOURCE = WORKFLOW.read_text()
MATCH = re.search(r"          /usr/bin/python3 -I -S - <<'PY'\n(.*?)\n          PY\n", SOURCE, re.S)
if not MATCH:
    raise AssertionError('probe heredoc absent or changed')
PROBE = textwrap.dedent(MATCH.group(1))
TOKEN = 'synthetic-probe-token'


class Response:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


class ProbeTest(unittest.TestCase):
    def invoke(self, effect=None, token=TOKEN):
        requests = []
        handlers = []

        class FakeOpener:
            def open(self, request, timeout):
                requests.append((request, timeout))
                if effect:
                    raise effect
                return Response()

        output = io.StringIO()
        def fake_build(*args):
            handlers.extend(args)
            return FakeOpener()

        with mock.patch.dict(os.environ, {'VERCEL_TOKEN': token, 'HTTPS_PROXY': 'https://invalid.example', 'SSL_CERT_FILE': '/invalid'}, clear=True), \
             mock.patch('urllib.request.build_opener', side_effect=fake_build), \
             contextlib.redirect_stdout(output), \
             contextlib.redirect_stderr(output):
            with self.assertRaises(SystemExit) as exited:
                exec(compile(PROBE, '<workflow-probe>', 'exec'), {})
        self.assertNotIn(TOKEN, output.getvalue())
        return exited.exception.code, output.getvalue(), requests, handlers

    def test_get_is_fixed_to_official_project_and_bounded(self):
        code, output, requests, handlers = self.invoke()
        self.assertEqual(code, 0)
        self.assertEqual(len(requests), 1)
        request, timeout = requests[0]
        self.assertEqual(request.get_method(), 'GET')
        self.assertEqual(timeout, 10)
        self.assertEqual(request.full_url, 'https://api.vercel.com/v7/deployments?projectId=prj_5swHVn2nqzrZ50VYx1zoEXZAvKiP&teamId=team_o4vau0vkVyakLaNFPmhXkL5M&target=production&limit=1&rollbackCandidate=true')
        self.assertEqual(request.get_header('Authorization'), 'Bearer ' + TOKEN)
        self.assertIn('rollback write permission were not checked', output)
        self.assertEqual(handlers[0].proxies, {})
        self.assertTrue(handlers[1]._context.check_hostname)
        self.assertEqual(handlers[1]._context.verify_mode, 2)
        self.assertIsNone(handlers[2].redirect_request(None, None, 302, None, {}, 'https://other.example/'))

    def test_denied_is_not_success_and_body_is_not_displayed(self):
        error = urllib.error.HTTPError('https://api.vercel.com/', 403, 'forbidden', {}, None)
        code, output, requests, _ = self.invoke(effect=error)
        self.assertEqual(code, 1)
        self.assertIn('returned HTTP 403', output)
        self.assertEqual(len(requests), 1)

    def test_redirect_and_network_errors_are_unknown(self):
        for error in (urllib.error.HTTPError('https://api.vercel.com/', 302, 'redirect', {}, None), TimeoutError()):
            with self.subTest(error=error):
                code, _, requests, _ = self.invoke(effect=error)
                self.assertEqual(code, 2)
                self.assertEqual(len(requests), 1)

    def test_invalid_token_never_builds_network_request(self):
        for token in ('', 'line\nbreak', 'x' * 1025):
            with self.subTest(token_length=len(token)):
                code, _, requests, _ = self.invoke(token=token)
                self.assertEqual(code, 2)
                self.assertEqual(requests, [])

    def test_research_workflow_guards_are_present(self):
        self.assertIn("github.event_name == 'workflow_dispatch'", SOURCE)
        self.assertIn("github.ref == 'refs/heads/research/vercel-token-get-probe'", SOURCE)
        self.assertIn('[[ "$PROBE_ACTUAL_SHA" == "$PROBE_EXPECTED_SHA" ]]', SOURCE)
        self.assertIn('  predeploy_migrate:\n    # Research branch only: never run the production migration/deployment DAG.\n    if: ${{ false }}', SOURCE)
        self.assertIn('  group: research-vercel-token-get-probe', SOURCE)
        self.assertNotIn('  group: production-deploy-main', SOURCE)
        probe_job = SOURCE.split('  vercel_scope_probe:', 1)[1].split('  predeploy_migrate:', 1)[0]
        self.assertNotIn('actions/checkout', probe_job)
        self.assertNotIn('npm ', probe_job)
        self.assertIn('    permissions: {}', probe_job)


if __name__ == '__main__':
    unittest.main()
