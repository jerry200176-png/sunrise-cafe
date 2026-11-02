#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

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
        return r.deploy(self.api, self.http, self.record, clock=self.clock,
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
            r.deploy(self.api, self.http, self.record, on_candidate=seen.append,
                     clock=self.clock, sleep=self.clock.sleep, seconds=10)
        self.assertEqual(seen, [NEW])
    def test_candidate_record_is_bound_to_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'candidate.json'
            r.write_candidate(path, NEW, SHA)
            self.assertEqual(r.read_candidate(path, SHA), NEW)
            with self.assertRaises(r.Unknown): r.read_candidate(path, OLD)
    def test_recovery_only_rolls_back_expected_source(self):
        self.api.current = NEW; self.http.commit = SHA
        self.assertEqual(self.recover(), 'rolled-back'); self.assertEqual(self.api.rollbacks, [BASE])
    def test_recovery_does_not_overwrite_other_source(self):
        self.api.current = 'dpl_other'; self.api.source_ok = False
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
    def test_token_never_goes_to_public_health(self):
        with self.assertRaises(r.Unknown): r.HTTP().request(r.HOST, '/', 'fake-secret')
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


if __name__ == '__main__': unittest.main()
