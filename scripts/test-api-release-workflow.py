#!/usr/bin/env python3
"""Offline workflow integration; no live provider calls."""
import hashlib
import importlib.util
import io
import json
import pathlib
import os
import subprocess
import tempfile
import unittest
import urllib.parse
import zipfile


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).with_name(file))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module


flow = load('workflow', 'api-release-workflow.py')
a = flow.artifacts
SHA = 'a' * 40


class FakeGitHub:
    def __init__(self): self.entries = {}; self.calls = []
    def upload(self, number, prefix, payload):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as z:
            z.writestr('intent.json' if prefix == 'api-release-intent' else 'candidate.json', json.dumps(payload))
        archive = output.getvalue(); digest = hashlib.sha256(archive).hexdigest()
        self.entries[str(number)] = (prefix, archive, digest)
        return str(number), digest
    def request(self, req, timeout):
        url = urllib.parse.urlsplit(req.full_url); self.calls.append((url.hostname, req.get_header('Authorization')))
        if url.hostname == 'artifact.example':
            key = url.path.rsplit('/', 1)[-1]; return 200, {}, self.entries[key][1]
        parts = url.path.split('/'); key = parts[-2] if parts[-1] == 'zip' else parts[-1]
        prefix, _, digest = self.entries[key]
        if parts[-1] == 'zip': return 302, {'Location': 'https://artifact.example/' + key}, b''
        metadata = {'id': int(key), 'name': prefix + '-123-1', 'expired': False, 'digest': 'sha256:' + digest,
                    'workflow_run': {'id': 123, 'head_sha': SHA}}
        return 200, {}, json.dumps(metadata).encode()
    def client(self): return a.GitHubArtifacts('synthetic', ['artifact.example'], self.request)


class FakePlatform:
    def __init__(self): self.alias = 'dpl_base'; self.created = 0; self.rolled_back = 0; self.fail_create = False; self.ready = 'READY'; self.recoverable = False; self.searches = 0
    def production_alias(self, *, deadline=None): return self.alias
    def create_production(self, sha, run_id, attempt):
        self.created += 1; self.alias = 'dpl_new'
        if self.fail_create: raise TimeoutError()
        return 'dpl_new'
    def deployment(self, deployment, *, deadline=None):
        return {'id': deployment, 'projectId': flow.w.PROJECT, 'target': 'production', 'readyState': self.ready,
                'meta': {'sunrise_run_id': '123', 'sunrise_run_attempt': '1', 'sunrise_commit': SHA},
                'gitSource': {'type': 'github', 'org': 'jerry200176-png', 'repo': 'sunrise-cafe', 'ref': 'main', 'sha': SHA}}
    def find_candidate(self, sha, run_id, attempt, *, deadline=None):
        self.searches += 1
        if not self.recoverable: raise RuntimeError('not uniquely observed')
        return 'dpl_new', self.deployment('dpl_new')
    def rollback_request(self, baseline, *, deadline=None): self.rolled_back += 1; self.alias = baseline; return {}


class Tests(unittest.TestCase):
    def test_committed_workflows_stop_before_legacy_or_new_release_steps(self):
        legacy = pathlib.Path('.github/workflows/production-deploy-migrate.yml').read_text()
        predeploy = legacy.split('  predeploy_migrate:\n', 1)[1].split('  predeploy_verify:\n', 1)[0]
        self.assertLess(predeploy.index('Stop legacy migration-first deployment'), predeploy.index('actions/checkout@'))
        workflow = pathlib.Path('.github/workflows/production-code-only.yml').read_text()
        release, recovery = workflow.split('  recovery:\n', 1)
        self.assertLess(release.index('Stop until release hold'), release.index('actions/checkout@'))
        self.assertLess(recovery.index('Stop until independent recovery'), recovery.index('actions/checkout@'))
        self.assertIn('group: production-deploy-main', workflow)
        for blocked in ('run-production-migration-phase', 'SUPABASE_DB_URL', 'psql ', 'vercel deploy'):
            self.assertNotIn(blocked, workflow)
    def test_cli_hard_stop_does_not_expose_credential(self):
        env = dict(os.environ, VERCEL_TOKEN='synthetic-do-not-print')
        result = subprocess.run(['python3', '-B', 'scripts/api-release-workflow.py', '--prepare'],
                                env=env, capture_output=True, text=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('hard-stopped', result.stderr)
        self.assertNotIn('synthetic-do-not-print', result.stdout + result.stderr)
    def setup_flow(self, directory):
        p, g, incidents = FakePlatform(), FakeGitHub(), []
        now = [0.0]
        def sleep(seconds): now[0] += seconds
        ctx = flow.Context(p, g.client(), lambda dep, _, **kw: dep == 'dpl_base', lambda reason, base: incidents.append((reason, base)),
                           '123', '1', SHA, runner_temp=directory, clock=lambda: now[0], sleep=sleep, wait_seconds=4, poll_seconds=1)
        intent_path = pathlib.Path(directory) / 'intent.json'; candidate_path = pathlib.Path(directory) / 'candidate.json'
        intent = ctx.prepare(intent_path)
        return ctx, p, g, incidents, intent, intent_path, candidate_path

    def test_full_chain_requires_remote_intent_and_candidate_then_rolls_back(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            iid, idigest = g.upload(456, 'api-release-intent', intent)
            self.assertEqual(ctx.create(ip, cp, intent_id=iid, intent_digest=idigest), 'candidate-recorded')
            cid, cdigest = g.upload(457, 'api-release-candidate', json.loads(cp.read_text()))
            self.assertEqual(ctx.verify(iid, idigest, cid, cdigest), 'rolled-back')
            self.assertEqual((p.alias, p.created, p.rolled_back), ('dpl_base', 1, 1))
            self.assertTrue(any(reason == 'live-verification-failed' for reason, _ in incidents))
            self.assertTrue(all(auth is None for host, auth in g.calls if host == 'artifact.example'))

    def test_missing_remote_write_ahead_never_creates_production(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            self.assertEqual(ctx.create(ip, cp, intent_id='456', intent_digest='0' * 64), 'unknown')
            self.assertEqual(p.created, 0); self.assertFalse(cp.exists())

    def test_lost_create_response_is_unknown_without_retry(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            iid, dig = g.upload(456, 'api-release-intent', intent); p.fail_create = True
            self.assertEqual(ctx.create(ip, cp, intent_id=iid, intent_digest=dig), 'unknown')
            self.assertEqual(p.created, 1); self.assertFalse(cp.exists())
            self.assertEqual(incidents[-1][0], 'production-outcome-unknown')
            p.alias = 'dpl_base'
            self.assertEqual(ctx.create(ip, cp, intent_id=iid, intent_digest=dig), 'unknown')
            self.assertEqual(p.created, 1)
            self.assertEqual(incidents[-1][0], 'create-claim-unavailable')

    def test_lost_create_response_preserves_only_untrusted_observation(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            iid, digest = g.upload(456, 'api-release-intent', intent); p.fail_create = True; p.recoverable = True
            self.assertEqual(ctx.create(ip, cp, intent_id=iid, intent_digest=digest), 'unknown')
            self.assertEqual((p.created, p.searches), (1, 1)); self.assertFalse(cp.exists())
            observation = json.loads(cp.with_name('observed-candidate.json').read_text())
            self.assertEqual(observation['kind'], 'untrusted-list-observation')
            self.assertEqual(observation['candidate'], 'dpl_new')
            # A different writer can copy public metadata; list evidence must
            # never be promoted into trusted candidate or automatic rollback.
            cid, cdigest = g.upload(457, 'api-release-candidate', observation)
            self.assertEqual(ctx.monitor(iid, digest, cid, cdigest), 'unknown')
            self.assertEqual(p.rolled_back, 0)

    def test_candidate_metadata_retries_do_not_repeat_production_create(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            iid, digest = g.upload(456, 'api-release-intent', intent)
            original = p.deployment; attempts = [0]
            def delayed(deployment, *, deadline=None):
                attempts[0] += 1
                if attempts[0] < 3: raise TimeoutError()
                return original(deployment)
            p.deployment = delayed
            self.assertEqual(ctx.create(ip, cp, intent_id=iid, intent_digest=digest), 'candidate-recorded')
            self.assertEqual((p.created, attempts[0]), (1, 3))

    def test_changing_candidate_directory_cannot_bypass_fixed_runner_claim(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            iid, digest = g.upload(456, 'api-release-intent', intent)
            self.assertEqual(ctx.create(ip, cp, intent_id=iid, intent_digest=digest), 'candidate-recorded')
            p.alias = 'dpl_base'
            other = pathlib.Path(tmp) / 'other'; other.mkdir()
            self.assertEqual(ctx.create(ip, other / 'candidate.json', intent_id=iid, intent_digest=digest), 'unknown')
            self.assertEqual(p.created, 1)

    def test_symlinked_claim_directory_fails_before_create(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            iid, digest = g.upload(456, 'api-release-intent', intent)
            root = pathlib.Path(tmp); (root / 'target').mkdir()
            (root / 'sunrise-api-release-claims').symlink_to(root / 'target', target_is_directory=True)
            self.assertEqual(ctx.create(ip, cp, intent_id=iid, intent_digest=digest), 'unknown')
            self.assertEqual(p.created, 0)
            self.assertEqual(list((root / 'target').iterdir()), [])

    def test_monitor_refuses_third_party_alias(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            iid, idigest = g.upload(456, 'api-release-intent', intent)
            self.assertEqual(ctx.create(ip, cp, intent_id=iid, intent_digest=idigest), 'candidate-recorded')
            cid, cdigest = g.upload(457, 'api-release-candidate', json.loads(cp.read_text())); p.alias = 'dpl_other'
            self.assertEqual(ctx.monitor(iid, idigest, cid, cdigest), 'unknown-owner')
            self.assertEqual(p.rolled_back, 0)

    def test_monitor_uses_both_verified_artifacts_to_recover_own_candidate(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            iid, idigest = g.upload(456, 'api-release-intent', intent)
            self.assertEqual(ctx.create(ip, cp, intent_id=iid, intent_digest=idigest), 'candidate-recorded')
            cid, cdigest = g.upload(457, 'api-release-candidate', json.loads(cp.read_text()))
            self.assertEqual(ctx.monitor(iid, idigest, cid, cdigest), 'rolled-back')
            self.assertEqual((p.alias, p.rolled_back), ('dpl_base', 1))

    def test_monitor_waits_for_delayed_alias_and_recovers_unhealthy_candidate(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            iid, idigest = g.upload(456, 'api-release-intent', intent)
            self.assertEqual(ctx.create(ip, cp, intent_id=iid, intent_digest=idigest), 'candidate-recorded')
            cid, cdigest = g.upload(457, 'api-release-candidate', json.loads(cp.read_text()))
            clock = [0.0]; ticks = [0]
            def sleep(seconds):
                ticks[0] += 1; clock[0] += seconds
                if ticks[0] == 2: p.ready = 'READY'
                if ticks[0] == 3: p.alias = 'dpl_new'
            ctx.clock = lambda: clock[0]; ctx.sleep = sleep
            p.ready = 'BUILDING'; p.alias = 'dpl_base'
            self.assertEqual(ctx.monitor(iid, idigest, cid, cdigest), 'rolled-back')
            self.assertEqual((ticks[0], p.alias, p.rolled_back), (3, 'dpl_base', 1))

    def test_monitor_does_not_report_building_candidate_as_restored(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            iid, idigest = g.upload(456, 'api-release-intent', intent); p.ready = 'BUILDING'
            self.assertEqual(ctx.create(ip, cp, intent_id=iid, intent_digest=idigest), 'candidate-recorded')
            cid, cdigest = g.upload(457, 'api-release-candidate', json.loads(cp.read_text()))
            self.assertEqual(ctx.monitor(iid, idigest, cid, cdigest), 'unknown')
            self.assertEqual((p.alias, p.rolled_back), ('dpl_base', 1))

    def test_monitor_reports_incident_write_failure_after_rollback(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            iid, idigest = g.upload(456, 'api-release-intent', intent)
            self.assertEqual(ctx.create(ip, cp, intent_id=iid, intent_digest=idigest), 'candidate-recorded')
            cid, cdigest = g.upload(457, 'api-release-candidate', json.loads(cp.read_text()))
            def broken(*_): raise OSError('synthetic')
            ctx.incident = broken
            self.assertEqual(ctx.monitor(iid, idigest, cid, cdigest), 'incident-unwritten')
            self.assertEqual((p.alias, p.rolled_back), ('dpl_base', 1))

    def test_missing_write_ahead_and_incident_failure_are_not_hidden(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            def broken(*_): raise OSError('synthetic')
            ctx.incident = broken
            self.assertEqual(ctx.create(ip, cp, intent_id='456', intent_digest='0' * 64), 'incident-unwritten')
            self.assertEqual(p.created, 0)

    def test_incident_storage_failure_does_not_prevent_rollback(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            iid, idigest = g.upload(456, 'api-release-intent', intent)
            self.assertEqual(ctx.create(ip, cp, intent_id=iid, intent_digest=idigest), 'candidate-recorded')
            cid, cdigest = g.upload(457, 'api-release-candidate', json.loads(cp.read_text()))
            def broken(*_): raise OSError('synthetic')
            ctx.incident = broken
            self.assertEqual(ctx.verify(iid, idigest, cid, cdigest), 'incident-unwritten')
            self.assertEqual((p.alias, p.rolled_back), ('dpl_base', 1))

    def test_still_building_candidate_remains_unknown_after_deadline(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            iid, idigest = g.upload(456, 'api-release-intent', intent); p.ready = 'BUILDING'
            self.assertEqual(ctx.create(ip, cp, intent_id=iid, intent_digest=idigest), 'candidate-recorded')
            cid, cdigest = g.upload(457, 'api-release-candidate', json.loads(cp.read_text()))
            self.assertEqual(ctx.verify(iid, idigest, cid, cdigest), 'unknown')
            self.assertEqual((p.alias, p.rolled_back), ('dpl_new', 0))
            self.assertEqual(incidents[-1][0], 'production-still-in-flight')

    def test_waits_for_slow_ready_and_delayed_alias_before_health(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            iid, idigest = g.upload(456, 'api-release-intent', intent)
            self.assertEqual(ctx.create(ip, cp, intent_id=iid, intent_digest=idigest), 'candidate-recorded')
            cid, cdigest = g.upload(457, 'api-release-candidate', json.loads(cp.read_text()))
            calls = [0]
            def sleep(seconds):
                calls[0] += 1
                if calls[0] == 2: p.ready = 'READY'
                if calls[0] == 3: p.alias = 'dpl_new'
                ctx.clock_now[0] += seconds
            ctx.clock_now = [0.0]; ctx.clock = lambda: ctx.clock_now[0]; ctx.sleep = sleep
            p.ready = 'BUILDING'; p.alias = 'dpl_base'
            ctx.health = lambda deployment, _, **kw: True
            self.assertEqual(ctx.verify(iid, idigest, cid, cdigest), 'verified')
            self.assertEqual(calls[0], 3)

    def test_ready_but_never_assigned_alias_is_unknown_after_deadline(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            iid, idigest = g.upload(456, 'api-release-intent', intent)
            self.assertEqual(ctx.create(ip, cp, intent_id=iid, intent_digest=idigest), 'candidate-recorded')
            cid, cdigest = g.upload(457, 'api-release-candidate', json.loads(cp.read_text()))
            p.alias = 'dpl_base'; p.ready = 'READY'
            self.assertEqual(ctx.verify(iid, idigest, cid, cdigest), 'unknown')
            self.assertEqual((p.alias, p.rolled_back), ('dpl_base', 0))
            self.assertEqual(incidents[-1][0], 'production-still-in-flight')

    def test_health_finishing_after_deadline_is_not_reported_verified(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            iid, idigest = g.upload(456, 'api-release-intent', intent)
            self.assertEqual(ctx.create(ip, cp, intent_id=iid, intent_digest=idigest), 'candidate-recorded')
            cid, cdigest = g.upload(457, 'api-release-candidate', json.loads(cp.read_text()))
            now = [0.0]; ctx.clock = lambda: now[0]
            def slow_health(*_, **__): now[0] = 10; return True
            ctx.health = slow_health
            self.assertEqual(ctx.verify(iid, idigest, cid, cdigest), 'unknown')
            self.assertEqual(incidents[-1][0], 'production-still-in-flight')

    def test_final_alias_finishing_after_deadline_is_not_verified(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            iid, idigest = g.upload(456, 'api-release-intent', intent)
            self.assertEqual(ctx.create(ip, cp, intent_id=iid, intent_digest=idigest), 'candidate-recorded')
            cid, cdigest = g.upload(457, 'api-release-candidate', json.loads(cp.read_text()))
            clock = [0.0]; calls = [0]; ctx.clock = lambda: clock[0]; ctx.health = lambda *_, **__: True
            def slow_final_alias(*, deadline=None):
                calls[0] += 1
                if calls[0] == 2: clock[0] = 5
                return 'dpl_new'
            p.production_alias = slow_final_alias
            self.assertEqual(ctx.verify(iid, idigest, cid, cdigest), 'unknown')
            self.assertEqual(incidents[-1][0], 'production-still-in-flight')

    def test_final_rollback_alias_after_deadline_is_not_restored(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            iid, idigest = g.upload(456, 'api-release-intent', intent)
            self.assertEqual(ctx.create(ip, cp, intent_id=iid, intent_digest=idigest), 'candidate-recorded')
            cid, cdigest = g.upload(457, 'api-release-candidate', json.loads(cp.read_text()))
            clock = [0.0]; calls = [0]; ctx.clock = lambda: clock[0]
            def slow_last(*, deadline=None):
                calls[0] += 1
                if calls[0] == 4: clock[0] = 61
                return p.alias
            p.production_alias = slow_last
            self.assertEqual(ctx.verify(iid, idigest, cid, cdigest), 'unknown')
            self.assertEqual(incidents[-1][0], 'rollback-unconfirmed')

    def test_monitor_final_alias_after_deadline_is_not_observed(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            iid, idigest = g.upload(456, 'api-release-intent', intent)
            self.assertEqual(ctx.create(ip, cp, intent_id=iid, intent_digest=idigest), 'candidate-recorded')
            cid, cdigest = g.upload(457, 'api-release-candidate', json.loads(cp.read_text()))
            clock = [0.0]; calls = [0]; ctx.clock = lambda: clock[0]; ctx.health = lambda *_, **__: True
            def slow_final(*, deadline=None):
                calls[0] += 1
                if calls[0] == 2: clock[0] = 5
                return 'dpl_new'
            p.production_alias = slow_final
            self.assertEqual(ctx.monitor(iid, idigest, cid, cdigest), 'unknown')
            self.assertEqual(incidents[-1][0], 'recovery-identity-unknown')

    def test_alias_change_during_health_is_not_reported_verified(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            ctx, p, g, incidents, intent, ip, cp = self.setup_flow(tmp)
            iid, idigest = g.upload(456, 'api-release-intent', intent)
            self.assertEqual(ctx.create(ip, cp, intent_id=iid, intent_digest=idigest), 'candidate-recorded')
            cid, cdigest = g.upload(457, 'api-release-candidate', json.loads(cp.read_text()))
            def concurrent_change(*_, **__): p.alias = 'dpl_other'; return True
            ctx.health = concurrent_change
            self.assertEqual(ctx.verify(iid, idigest, cid, cdigest), 'unknown')
            self.assertEqual(p.rolled_back, 0)

    def test_symlink_record_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-workflow-') as tmp:
            root = pathlib.Path(tmp); (root / 'link').symlink_to(root / 'target')
            with self.assertRaises(OSError): flow.read_record(root / 'link')
            (root / 'real').mkdir(); (root / 'real' / 'intent.json').write_text('{}')
            (root / 'dirlink').symlink_to(root / 'real', target_is_directory=True)
            with self.assertRaises(OSError): flow.read_record(root / 'dirlink' / 'intent.json')


if __name__ == '__main__': unittest.main()
