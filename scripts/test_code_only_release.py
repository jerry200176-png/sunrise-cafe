#!/usr/bin/env python3
import importlib.util
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('code-only-release.py'))
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
SHA, OLD = 'a' * 40, 'b' * 40
BASE, NEW = 'dpl_baseline', 'dpl_candidate'


class FakeHTTP:
    def __init__(self): self.commit = OLD; self.healthy = True
    def request(self, host, path, token=None, body=None, timeout=15):
        if path == '/api/version': return 200, {'commit': self.commit}, b'{}'
        if path == '/api/booking-health': return 200, {'ok': self.healthy}, b'{}'
        return 200, None, b'<html></html>'


class FakeVercel:
    def __init__(self, http):
        self.http, self.current, self.created, self.rollbacks = http, BASE, 0, []
        self.source_ok, self.ready, self.bad_health = True, True, False
    def alias(self): return self.current
    def deployment(self, ident):
        git = {'type': 'github', 'org': 'jerry200176-png', 'repo': 'sunrise-cafe',
               'ref': 'main', 'sha': SHA if self.source_ok else OLD}
        return {'id': ident, 'projectId': r.PROJECT, 'target': 'production',
                'readyState': 'READY' if self.ready else 'BUILDING', 'gitSource': git}
    def create(self, sha):
        self.created += 1; self.current = NEW; self.http.commit = sha
        self.http.healthy = not self.bad_health
        return NEW
    def rollback(self, ident):
        self.rollbacks.append(ident); self.current = ident; self.http.commit = OLD; self.http.healthy = True
    def cancel(self, ident):
        self.ready = False
        return True


class FakeClock:
    def __init__(self): self.now = 0
    def __call__(self): return self.now
    def sleep(self, delay): self.now += delay


class Tests(unittest.TestCase):
    def setUp(self):
        self.http = FakeHTTP(); self.api = FakeVercel(self.http)
        self.record = {'baseline': BASE, 'previous': OLD, 'commit': SHA}
        self.clock = FakeClock()
    def deploy(self):
        candidate = r.create_candidate(self.api, self.record)
        return r.verify_candidate(self.api, self.http, self.record, candidate, clock=self.clock,
                                  sleep=self.clock.sleep, seconds=10)
    def recover(self, candidate=None):
        return r.recover(self.api, self.http, self.record, candidate, clock=self.clock,
                         sleep=self.clock.sleep, seconds=10)
    def test_deploy_reviewed_candidate_once(self):
        self.assertEqual(self.deploy(), NEW); self.assertEqual(self.api.created, 1)
    def test_unhealthy_candidate_is_rolled_back(self):
        self.api.bad_health = True
        with self.assertRaises(r.Unknown): self.deploy()
        self.assertEqual(self.api.rollbacks, [BASE]); self.assertEqual(self.api.current, BASE)
    def test_changed_baseline_never_creates(self):
        self.api.current = 'dpl_other'
        with self.assertRaises(r.Unknown): self.deploy()
        self.assertEqual(self.api.created, 0)
    def test_unknown_create_is_not_retried(self):
        def unknown(_): self.api.created += 1; raise r.Unknown('timeout')
        self.api.create = unknown
        with self.assertRaises(r.Unknown): self.deploy()
        self.assertEqual(self.api.created, 1)
    def test_candidate_is_recorded_before_polling(self):
        seen = []
        def no_metadata(_):
            self.assertEqual(seen, [NEW])
            raise r.Unknown('metadata unavailable')
        self.api.deployment = no_metadata
        with self.assertRaises(r.Unknown):
            candidate = r.create_candidate(self.api, self.record, on_candidate=seen.append)
            r.verify_candidate(self.api, self.http, self.record, candidate,
                               clock=self.clock, sleep=self.clock.sleep, seconds=10)
        self.assertEqual(seen, [NEW])
    def test_candidate_record_is_bound_to_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'candidate.json'
            r.write_candidate(path, NEW, SHA)
            self.assertEqual(r.read_candidate(path, SHA), NEW)
            with self.assertRaises(r.Unknown): r.read_candidate(path, OLD)
    def test_job_output_survives_missing_artifact_and_binds_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'output'
            missing_artifact = Path(directory) / 'candidate.json'
            r.output_candidate(output, NEW, SHA)
            fields = dict(line.split('=', 1) for line in output.read_text().splitlines())
            candidate = r.recovery_candidate(missing_artifact, SHA, fields['candidate'], fields['candidate_commit'])
            self.api.current = NEW; self.http.commit = SHA
            self.assertEqual(self.recover(candidate), 'rolled-back')
            with self.assertRaises(r.Unknown): r.recovery_candidate(missing_artifact, SHA, NEW, OLD)
            self.assertIsNone(r.recovery_candidate(missing_artifact, SHA, '', ''))
            r.write_candidate(missing_artifact, 'dpl_other', SHA)
            with self.assertRaises(r.Unknown): r.recovery_candidate(missing_artifact, SHA, NEW, SHA)
    def test_recovery_only_rolls_back_expected_source(self):
        self.api.current = NEW; self.http.commit = SHA
        self.assertEqual(self.recover(NEW), 'rolled-back'); self.assertEqual(self.api.rollbacks, [BASE])
    def test_live_candidate_still_building_is_unknown_not_rolled_back(self):
        self.api.current = NEW; self.api.ready = False
        with self.assertRaises(r.Unknown): self.recover(NEW)
        self.assertEqual(self.api.rollbacks, [])
    def test_recovery_does_not_overwrite_other_source(self):
        self.api.current = 'dpl_other'; self.api.source_ok = False
        with self.assertRaises(r.Unknown): self.recover(NEW)
        self.assertEqual(self.api.rollbacks, [])
    def test_recovery_does_not_overwrite_same_sha_from_another_deployment(self):
        self.api.current = 'dpl_other'; self.api.source_ok = True
        with self.assertRaises(r.Unknown): self.recover(NEW)
        self.assertEqual(self.api.rollbacks, [])
    def test_recovery_does_not_infer_ownership_from_sha(self):
        self.api.current = NEW; self.api.source_ok = True
        with self.assertRaises(r.Unknown): self.recover()
        self.assertEqual(self.api.rollbacks, [])
    def test_inflight_baseline_is_not_claimed_as_recovered(self):
        with self.assertRaises(r.Unknown): self.recover()
        self.assertEqual(self.api.rollbacks, [])
    def test_known_inflight_deployment_is_cancelled(self):
        self.api.ready = False
        self.assertEqual(self.recover(NEW), 'baseline')
        self.assertEqual(self.api.current, BASE)
    def test_failed_cancel_waits_for_late_alias_and_rolls_back(self):
        self.api.ready = False
        def raced(_):
            self.api.current = NEW; self.api.ready = True; self.http.commit = SHA
            raise r.Unknown('already ready')
        self.api.cancel = raced
        self.assertEqual(self.recover(NEW), 'rolled-back')
        self.assertEqual(self.api.rollbacks, [BASE])
    def test_candidate_source_mismatch_fails(self):
        self.api.source_ok = False
        with self.assertRaises(r.Unknown): self.deploy()
        self.assertEqual(self.api.created, 1)
    def test_optional_git_source_may_be_absent_while_building(self):
        calls = []
        original = self.api.deployment
        def delayed(ident):
            calls.append(ident)
            if len(calls) == 1:
                data = original(ident); data['readyState'] = 'BUILDING'; data.pop('gitSource')
                return data
            return original(ident)
        self.api.deployment = delayed
        self.assertEqual(self.deploy(), NEW)
        self.assertGreaterEqual(len(calls), 2)
    def test_missing_source_when_ready_is_unknown(self):
        original = self.api.deployment
        def missing(ident):
            data = original(ident); data.pop('gitSource'); return data
        self.api.deployment = missing
        with self.assertRaises(r.Unknown): self.deploy()
    def test_token_never_goes_to_public_health(self):
        with self.assertRaises(r.Unknown): r.HTTP().request(r.HOST, '/', 'fake-secret')
    def test_network_error_does_not_expose_token_or_use_proxy(self):
        with mock.patch.object(r.urllib.request, 'build_opener') as make:
            make.return_value.open.side_effect = RuntimeError('synthetic-secret')
            with self.assertRaises(r.Unknown) as error:
                r.HTTP().request('api.vercel.com', '/v7/deployments', 'synthetic-secret')
            self.assertNotIn('synthetic-secret', str(error.exception))
            self.assertEqual(make.call_args.args[0].proxies, {})
    def test_redirect_rejected(self):
        with self.assertRaises(r.Unknown):
            r.NoRedirect().redirect_request(None, None, 302, None, None, 'https://example.invalid')
    def test_code_only_manifest_rejects_schema_and_changed_application_files(self):
        blob = 'c' * 40
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory) / 'manifest.json'
            manifest.write_text(json.dumps({'baseline': r.APPROVED_BASELINE,
                                            'approved_files': {'src/app.ts': blob}}))
            state = {'paths': ['src/app.ts', '.github/workflows/ci.yml'], 'blob': blob, 'mode': '100644'}
            def git(*args):
                if args[0] == 'merge-base': return b''
                if args[0] == 'diff': return ('\0'.join(state['paths']) + '\0').encode()
                if args[0] == 'rev-parse': return state['blob'].encode()
                if args[0] == 'ls-tree': return (state['mode'] + ' blob ' + blob + '\tsrc/app.ts').encode()
                raise AssertionError(args)
            r.verify_code_only(r.APPROVED_BASELINE, SHA, git=git, manifest_path=manifest)
            state['paths'].append('supabase/migration-new.sql')
            with self.assertRaises(r.Unknown): r.verify_code_only(r.APPROVED_BASELINE, SHA, git=git, manifest_path=manifest)
            state['paths'].pop(); state['blob'] = 'd' * 40
            with self.assertRaises(r.Unknown): r.verify_code_only(r.APPROVED_BASELINE, SHA, git=git, manifest_path=manifest)
            state['blob'] = blob; state['mode'] = '120000'
            with self.assertRaises(r.Unknown): r.verify_code_only(r.APPROVED_BASELINE, SHA, git=git, manifest_path=manifest)
            with self.assertRaises(r.Unknown): r.verify_code_only(OLD, SHA, git=git, manifest_path=manifest)

    def test_manifest_against_isolated_git_history(self):
        # Validate actual Git objects without binding the test suite to this
        # one-time release's HEAD or the files changed by a future PR.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / 'repo'
            repo.mkdir()
            env = {'PATH': os.defpath, 'LC_ALL': 'C', 'GIT_CONFIG_NOSYSTEM': '1',
                   'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_TERMINAL_PROMPT': '0'}

            def git(*args):
                result = subprocess.run(['git', '-C', str(repo), '-c', 'user.name=Test',
                                         '-c', 'user.email=test@example.invalid',
                                         '-c', 'core.hooksPath=/dev/null', *args],
                                        env=env, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, check=True)
                return result.stdout

            git('init', '-q')
            (repo / 'base.txt').write_text('base\n')
            git('add', 'base.txt')
            git('commit', '-qm', 'baseline')
            baseline = git('rev-parse', 'HEAD').decode().strip()
            (repo / 'src').mkdir()
            (repo / 'src' / 'app.ts').write_text('reviewed\n')
            git('add', 'src/app.ts')
            git('commit', '-qm', 'reviewed change')
            reviewed = git('rev-parse', 'HEAD').decode().strip()
            blob = git('rev-parse', 'HEAD:src/app.ts').decode().strip()
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps({'baseline': baseline,
                                            'approved_files': {'src/app.ts': blob}}))

            with mock.patch.object(r, 'APPROVED_BASELINE', baseline):
                r.verify_code_only(baseline, reviewed, git=git, manifest_path=manifest)
                (repo / 'supabase').mkdir()
                (repo / 'supabase' / 'migration-unreviewed.sql').write_text('-- synthetic\n')
                git('add', 'supabase/migration-unreviewed.sql')
                git('commit', '-qm', 'unreviewed change')
                changed = git('rev-parse', 'HEAD').decode().strip()
                with self.assertRaises(r.Unknown):
                    r.verify_code_only(baseline, changed, git=git, manifest_path=manifest)


class CreateDiagnosticTests(unittest.TestCase):
    """Synthetic responses only: never connect to Vercel or print response details."""

    class Response:
        def __init__(self, status, data): self.status, self.data = status, data
        def __enter__(self): return self
        def __exit__(self, *_args): return False
        def read(self, _size):
            if isinstance(self.data, Exception): raise self.data
            return self.data

    class Body(io.BytesIO):
        def __init__(self): super().__init__(b'synthetic-body-canary'); self.reads = 0
        def read(self, *args): self.reads += 1; return super().read(*args)

    def run_create(self, response, *, stage='post', accepted=False):
        calls, bodies, state = [], [], {'accepted': False, 'alias': BASE}
        record = {'baseline': BASE, 'previous': OLD, 'commit': SHA}

        def http_error(code):
            body = self.Body(); bodies.append(body)
            return r.urllib.error.HTTPError(
                'https://synthetic.invalid/path?synthetic-query-canary', code,
                'synthetic-reason-canary', {'X-Fake': 'synthetic-header-canary'}, body)

        def open_request(req, timeout):
            del timeout
            parsed = r.urllib.parse.urlsplit(req.full_url)
            calls.append((parsed.hostname, parsed.path, req.get_method()))
            if parsed.hostname == 'api.github.com':
                if stage == 'github': raise http_error(response)
                return self.Response(200, json.dumps({'object': {'sha': SHA}}).encode())
            if parsed.path.startswith('/v4/aliases/'):
                if stage == 'alias': raise http_error(response)
                return self.Response(200, json.dumps({'deploymentId': BASE, 'projectId': r.PROJECT}).encode())
            if parsed.path == '/v13/deployments' and req.get_method() == 'POST':
                state['accepted'] = accepted
                if accepted: state['alias'] = NEW
                if isinstance(response, tuple): return self.Response(*response)
                if isinstance(response, Exception): raise response
                if response == 'redirect':
                    r.NoRedirect().redirect_request(req, None, 302, 'synthetic-reason-canary', {},
                                                    'https://synthetic.invalid/?synthetic-query-canary')
                raise http_error(response)
            raise AssertionError('Unexpected synthetic request')

        opener = mock.Mock(); opener.open.side_effect = open_request
        env = {'GITHUB_SHA': SHA, 'GITHUB_REF': 'refs/heads/main',
               'VERCEL_TOKEN': 'synthetic-token-canary', 'GH_TOKEN': 'synthetic-gh-canary',
               'RUNNER_TEMP': '/synthetic', 'GITHUB_OUTPUT': '/synthetic/output'}
        stderr, stdout = io.StringIO(), io.StringIO()
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(r.sys, 'argv', ['release', 'create']), \
             mock.patch.object(r, 'read_record', return_value=record), mock.patch.object(r, 'verify_code_only'), \
             mock.patch.object(r.urllib.request, 'build_opener', return_value=opener), \
             contextlib.redirect_stderr(stderr), contextlib.redirect_stdout(stdout):
            with self.assertRaises(SystemExit) as failure: r.main()
        output = stdout.getvalue() + stderr.getvalue() + str(failure.exception)
        for canary in ('synthetic-token-canary', 'synthetic-gh-canary', 'synthetic-query-canary',
                       'synthetic-reason-canary', 'synthetic-header-canary', 'synthetic-body-canary'):
            self.assertNotIn(canary, output)
        self.assertIn('Release failed or outcome unknown', output)
        self.assertTrue(all(body.reads == 0 for body in bodies))
        return calls, state, output

    def test_http_status_categories_and_redaction(self):
        for code, category in [(403, 'http_4xx'), (429, 'http_429'), (503, 'http_5xx'),
                               (302, 'http_other'), ('synthetic-status-canary', 'unclassified')]:
            with self.subTest(code=code):
                calls, _state, output = self.run_create(code)
                self.assertIn('Deployment create outcome unknown; HTTP status category: ' + category, output)
                self.assertNotIn('synthetic-status-canary', output)
                self.assertEqual(sum(method == 'POST' for _host, _path, method in calls), 1)

    def test_preflight_get_errors_are_not_called_create_post(self):
        for stage in ('github', 'alias'):
            with self.subTest(stage=stage):
                calls, _state, output = self.run_create(429, stage=stage)
                self.assertNotIn('HTTP status category:', output)
                self.assertEqual(sum(method == 'POST' for _host, _path, method in calls), 0)

    def test_network_error_and_redirect_remain_unknown_without_status_or_retry(self):
        for response in (TimeoutError('synthetic-reason-canary'), 'redirect'):
            with self.subTest(response_type=type(response).__name__):
                calls, _state, output = self.run_create(response)
                self.assertNotIn('HTTP status category:', output)
                self.assertEqual(sum(method == 'POST' for _host, _path, method in calls), 1)

    def test_unusable_2xx_response_is_still_unknown(self):
        cases = [(200, b'{'), (200, b'{}'), (200, b'[]'), (200, b''),
                 (200, b'{"id":"synthetic-body-canary"}'),
                 (200, TimeoutError('synthetic-reason-canary')),
                 (200, b'x' * (r.MAX_BODY + 1))]
        for response in cases:
            with self.subTest(response_type=type(response[1]).__name__):
                calls, _state, output = self.run_create(response)
                self.assertIn('Deployment create outcome unknown; HTTP status category: http_2xx', output)
                self.assertEqual(sum(method == 'POST' for _host, _path, method in calls), 1)

    def test_accepted_then_error_is_not_retried_or_inferred_recoverable(self):
        for status in (429, 503):
            with self.subTest(status=status):
                calls, state, output = self.run_create(status, accepted=True)
                self.assertTrue(state['accepted'])
                self.assertIn('create outcome unknown', output)
                self.assertEqual(sum(method == 'POST' for _host, _path, method in calls), 1)
                fake_http = FakeHTTP(); api = FakeVercel(fake_http); api.current = state['alias']
                with self.assertRaises(r.Unknown):
                    r.recover(api, fake_http, {'baseline': BASE, 'previous': OLD, 'commit': SHA}, None,
                              clock=FakeClock(), sleep=lambda _seconds: None, seconds=1)
                self.assertEqual(api.rollbacks, [])

    def test_invalid_category_and_exception_text_cannot_reach_output(self):
        fake = r.CreateStatusUnknown('synthetic-category-canary')
        self.assertEqual(fake.category, 'unclassified')
        self.assertNotIn('synthetic-category-canary', str(fake))
        for status in (True, None, -1, 999, 'synthetic-status-canary'):
            self.assertEqual(r.http_category(status), 'unclassified')

    def test_main_rechecks_category_before_output(self):
        forged = r.CreateStatusUnknown('http_429')
        forged.category = 'synthetic-category-canary'
        env = {'GITHUB_SHA': SHA, 'GITHUB_REF': 'refs/heads/main', 'VERCEL_TOKEN': 'synthetic-token-canary',
               'GH_TOKEN': 'synthetic-gh-canary', 'RUNNER_TEMP': '/synthetic'}
        stderr = io.StringIO()
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(r.sys, 'argv', ['release', 'create']), \
             mock.patch.object(r, 'read_record', return_value={'baseline': BASE, 'previous': OLD, 'commit': SHA}), \
             mock.patch.object(r, 'verify_code_only'), mock.patch.object(r, 'create_candidate', side_effect=forged), \
             mock.patch.object(r.GitHub, 'main_sha', return_value=SHA), contextlib.redirect_stderr(stderr):
            with self.assertRaises(SystemExit): r.main()
        self.assertIn('HTTP status category: unclassified', stderr.getvalue())
        self.assertNotIn('synthetic-category-canary', stderr.getvalue())


if __name__ == '__main__': unittest.main()
