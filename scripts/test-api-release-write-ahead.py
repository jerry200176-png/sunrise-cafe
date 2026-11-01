#!/usr/bin/env python3
import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('write_ahead', pathlib.Path(__file__).with_name('api-release-write-ahead.py'))
w = importlib.util.module_from_spec(spec); spec.loader.exec_module(w)
INTENT = {'version': 1, 'intent': 'code-only-release', 'run_id': '123', 'attempt': '1', 'commit': 'a' * 40, 'baseline': 'dpl_base', 'project': w.PROJECT}


class Tests(unittest.TestCase):
    def test_workflow_requires_upload_and_receipt_before_disabled_release(self):
        workflow = pathlib.Path('.github/workflows/production-code-only.yml').read_text()
        ordered = ['Stop until release hold and recovery prerequisites are resolved', 'Prepare release intent',
                   'Upload write-ahead intent', 'Require write-ahead upload receipt',
                   'Create production candidate and persist identity', 'Upload candidate evidence',
                   'Require candidate upload receipt', 'Verify production or attempt rollback']
        offsets = [workflow.index(step) for step in ordered]
        self.assertEqual(offsets, sorted(offsets))
    def test_intent_is_exclusive_and_contains_only_required_fields(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-intent-') as tmp:
            path = pathlib.Path(tmp) / 'intent.json'; w.write_intent(path, INTENT)
            self.assertEqual(json.loads(path.read_text()), INTENT)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError): w.write_intent(path, INTENT)
    def test_unknown_or_sensitive_fields_are_rejected(self):
        for bad in ({**INTENT, 'secret': 'synthetic'}, {**INTENT, 'project': 'other'}, {**INTENT, 'commit': 'a'}):
            with self.assertRaises(ValueError): w.validate(bad)
    def test_intent_parent_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix='sunrise-intent-') as tmp:
            root = pathlib.Path(tmp); (root / 'real').mkdir()
            (root / 'link').symlink_to(root / 'real', target_is_directory=True)
            with self.assertRaises(OSError): w.write_intent(root / 'link' / 'intent.json', INTENT)
            self.assertFalse((root / 'real' / 'intent.json').exists())
    def test_receipt_requires_success_and_shaped_id_digest(self):
        self.assertTrue(w.receipt_valid(True, '123', 'a' * 64))
        for args in ((False, '123', 'a' * 64), (True, '0', 'a' * 64), (True, '123', 'bad')):
            self.assertFalse(w.receipt_valid(*args))
    def test_baseline_may_change_later_even_when_currently_live(self):
        self.assertEqual(w.decision(INTENT, '123', 'dpl_base', attempt='1'), 'unknown-in-flight')
    def test_matching_commit_alone_does_not_prove_candidate_ownership(self):
        self.assertEqual(w.decision(INTENT, '123', 'dpl_new', 'dpl_new', attempt='1'), 'unknown-owner')
        for not_bound in ('false', 1, 'true'):
            self.assertEqual(w.decision(INTENT, '123', 'dpl_new', 'dpl_new', not_bound, False, attempt='1'), 'unknown-owner')
    def test_third_party_alias_never_rolls_back(self):
        self.assertEqual(w.decision(INTENT, '123', 'dpl_external', 'dpl_new', True, False, attempt='1'), 'unknown-owner')
    def test_verified_candidate_unhealthy_requires_recovery(self):
        self.assertEqual(w.decision(INTENT, '123', 'dpl_new', 'dpl_new', True, False, attempt='1'), 'rollback-candidate')
        self.assertEqual(w.decision(INTENT, '123', 'dpl_new', 'dpl_new', True, None, attempt='1'), 'rollback-candidate')
        self.assertEqual(w.decision(INTENT, '123', 'dpl_new', 'dpl_new', True, True, attempt='1'), 'observe')
    def test_other_run_is_rejected(self):
        self.assertEqual(w.decision(INTENT, '124', 'dpl_new', 'dpl_new', True, False, attempt='1'), 'unknown')
        self.assertEqual(w.decision(INTENT, '123', 'dpl_new', 'dpl_new', True, False, attempt='2'), 'unknown')
    def test_monitor_rolls_back_only_bound_unhealthy_candidate_and_checks_health(self):
        class Provider:
            current = 'dpl_new'
            def alias(self): return self.current
            def health(self, deployment): return deployment == 'dpl_base'
            def rollback(self, deployment): self.current = deployment
        p = Provider()
        self.assertEqual(w.monitor(p, INTENT, '123', 'dpl_new', True, attempt='1'), 'rolled-back')
        self.assertEqual(p.current, 'dpl_base')
    def test_monitor_does_not_overwrite_alias_changed_before_rollback(self):
        class Provider:
            calls = 0
            def alias(self):
                self.calls += 1
                return 'dpl_new' if self.calls == 1 else 'dpl_other'
            def health(self, deployment): return False
            def rollback(self, deployment): raise AssertionError('must not rollback')
        self.assertEqual(w.monitor(Provider(), INTENT, '123', 'dpl_new', True, attempt='1'), 'unknown-owner')
    def test_unknown_health_of_bound_candidate_attempts_rollback(self):
        class Provider:
            current = 'dpl_new'
            def alias(self): return self.current
            def health(self, deployment):
                if deployment == 'dpl_new': raise TimeoutError()
                return True
            def rollback(self, deployment): self.current = deployment
        p = Provider()
        self.assertEqual(w.monitor(p, INTENT, '123', 'dpl_new', True, attempt='1'), 'rolled-back')
    def test_baseline_does_not_trigger_health_or_rollback(self):
        class Provider:
            def alias(self): return 'dpl_base'
            def health(self, deployment): raise AssertionError('must not check')
            def rollback(self, deployment): raise AssertionError('must not rollback')
        self.assertEqual(w.monitor(Provider(), INTENT, '123', attempt='1'), 'unknown-in-flight')


if __name__ == '__main__': unittest.main()
