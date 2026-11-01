#!/usr/bin/env python3
"""Synthetic rules, exact PR head and merged-tree verification."""
import copy
import importlib.util
import json
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('source', pathlib.Path(__file__).with_name('api-release-source.py'))
s = importlib.util.module_from_spec(spec); spec.loader.exec_module(s)
MERGE, HEAD, TREE = 'a' * 40, 'b' * 40, 'c' * 40
NAMES = ['Lint & Build', 'Playwright smoke', 'Agent Session Provenance']


class FakeGitHub:
    def __init__(self):
        self.rules = [{'type': 'required_status_checks', 'parameters': {'strict_required_status_checks_policy': True,
                      'required_status_checks': [{'context': name} for name in NAMES]}}]
        self.pulls = [{'merge_commit_sha': MERGE, 'merged_at': '2026-01-01T00:00:00Z',
                       'base': {'ref': 'main'}, 'head': {'sha': HEAD}}]
        self.commits = {x: {'sha': x, 'tree': {'sha': TREE}} for x in (MERGE, HEAD)}
        self.runs = {'total_count': 3, 'check_runs': [
            {'id': n + 1, 'name': name, 'status': 'completed', 'conclusion': 'success',
             'head_sha': HEAD, 'started_at': '2026-01-01T00:00:00Z', 'app': {'id': 1}}
            for n, name in enumerate(NAMES)]}
        self.statuses = {'total_count': 0, 'statuses': []}
    def _request(self, url, authenticated):
        assert authenticated and url.startswith(s.BASE)
        path = url[len(s.BASE):]
        if path == '/rules/branches/main?per_page=100': data = self.rules
        elif path == '/commits/' + MERGE + '/pulls?per_page=100': data = self.pulls
        elif path.startswith('/git/commits/'): data = self.commits[path.rsplit('/', 1)[-1]]
        elif path == '/commits/' + HEAD + '/check-runs?per_page=100': data = self.runs
        elif path == '/commits/' + HEAD + '/status?per_page=100': data = self.statuses
        else: raise AssertionError('unexpected API path')
        return 200, {}, json.dumps(data).encode()


class Tests(unittest.TestCase):
    def test_matching_strict_rules_exact_head_and_merge_tree(self):
        result = s.verify(FakeGitHub(), MERGE, TREE)
        self.assertEqual((result['head'], result['merge'], result['tree']), (HEAD, MERGE, TREE))
        self.assertEqual(set(result['required']), set(NAMES))
    def test_non_strict_or_missing_required_check_fails(self):
        for missing in (True, False):
            f = FakeGitHub()
            if missing: f.rules[0]['parameters']['required_status_checks'].pop()
            else: f.rules[0]['parameters']['strict_required_status_checks_policy'] = False
            with self.assertRaises(s.Unverified): s.verify(f, MERGE, TREE)
    def test_wrong_merge_head_or_tree_fails(self):
        for field in ('merge', 'tree', 'check_head'):
            f = FakeGitHub()
            if field == 'merge': f.pulls[0]['merge_commit_sha'] = 'd' * 40
            elif field == 'tree': f.commits[HEAD]['tree']['sha'] = 'd' * 40
            else: f.runs['check_runs'][0]['head_sha'] = 'd' * 40
            with self.subTest(field=field), self.assertRaises(s.Unverified): s.verify(f, MERGE, TREE)
    def test_pending_or_newer_failure_cannot_pass(self):
        f = FakeGitHub(); f.runs['check_runs'][0]['status'] = 'in_progress'
        with self.assertRaises(s.Unverified): s.verify(f, MERGE, TREE)
        f = FakeGitHub(); retry = copy.deepcopy(f.runs['check_runs'][0]); retry.update(id=99, started_at='2026-01-02T00:00:00Z', conclusion='failure')
        f.runs['check_runs'].append(retry); f.runs['total_count'] += 1
        with self.assertRaises(s.Unverified): s.verify(f, MERGE, TREE)
    def test_newer_successful_retry_passes(self):
        f = FakeGitHub(); f.runs['check_runs'][0]['conclusion'] = 'failure'
        retry = copy.deepcopy(f.runs['check_runs'][0]); retry.update(id=99, started_at='2026-01-02T00:00:00Z', conclusion='success')
        f.runs['check_runs'].append(retry); f.runs['total_count'] += 1
        self.assertEqual(s.verify(f, MERGE, TREE)['head'], HEAD)
    def test_pagination_or_required_app_mismatch_fails(self):
        f = FakeGitHub(); f.runs['total_count'] = 4
        with self.assertRaises(s.Unverified): s.verify(f, MERGE, TREE)
        f = FakeGitHub(); f.rules[0]['parameters']['required_status_checks'][0]['integration_id'] = 5
        with self.assertRaises(s.Unverified): s.verify(f, MERGE, TREE)
    def test_conflicting_legacy_status_must_also_be_green(self):
        f = FakeGitHub(); f.statuses = {'total_count': 1, 'statuses': [{'id': 10, 'context': NAMES[0], 'state': 'failure', 'created_at': '2026-01-01T00:00:00Z'}]}
        with self.assertRaises(s.Unverified): s.verify(f, MERGE, TREE)


if __name__ == '__main__': unittest.main()
