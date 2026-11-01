#!/usr/bin/env python3
"""Artifact and deployment binding tests: all HTTP is synthetic."""
import hashlib
import importlib.util
import io
import json
import pathlib
import stat
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('artifacts', pathlib.Path(__file__).with_name('api-release-artifacts.py'))
a = importlib.util.module_from_spec(spec); spec.loader.exec_module(a)
INTENT = {'version': 1, 'intent': 'code-only-release', 'run_id': '123', 'attempt': '1',
          'commit': 'a' * 40, 'baseline': 'dpl_base', 'project': a.w.PROJECT}


def archive_of(value, name='intent.json', mode=0o100600):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as z:
        info = zipfile.ZipInfo(name); info.external_attr = mode << 16
        z.writestr(info, json.dumps(value))
    return output.getvalue()


class FakeGitHub:
    def __init__(self, archive, prefix='api-release-intent'):
        self.archive = archive; self.calls = []
        self.digest = hashlib.sha256(archive).hexdigest()
        self.location = 'https://artifact.example/archive?synthetic=1'
        self.meta = {'id': 456, 'name': prefix + '-123-1', 'expired': False,
                     'digest': 'sha256:' + self.digest,
                     'workflow_run': {'id': 123, 'head_sha': 'a' * 40}}
    def __call__(self, req, timeout):
        self.calls.append((req.full_url, req.get_header('Authorization')))
        if req.full_url.endswith('/456'): return 200, {}, json.dumps(self.meta).encode()
        if req.full_url.endswith('/456/zip'): return 302, {'Location': self.location}, b''
        return 200, {}, self.archive
    def api(self): return a.GitHubArtifacts('synthetic-token', ['artifact.example'], self)
    def fetch(self): return self.api().fetch('456', '123', '1', 'a' * 40, self.digest)


class Tests(unittest.TestCase):
    def test_default_transport_is_disabled(self):
        with self.assertRaises(a.InvalidEvidence):
            a.GitHubArtifacts('synthetic-token', []).fetch('456', '123', '1', 'a' * 40, 'b' * 64)
    def test_run_metadata_digest_and_archive_are_checked(self):
        fake = FakeGitHub(archive_of(INTENT))
        result = fake.fetch(); self.assertEqual(a.w.validate(result), INTENT)
        self.assertTrue(all(x[1] == 'Bearer synthetic-token' for x in fake.calls[:2]))
        self.assertIsNone(fake.calls[2][1])
    def test_metadata_must_match_identity(self):
        for field, bad in [('id', 999), ('name', 'api-release-intent-123-2'), ('expired', True), ('digest', 'sha256:' + '0' * 64)]:
            fake = FakeGitHub(archive_of(INTENT)); fake.meta[field] = bad
            with self.subTest(field=field), self.assertRaises(a.InvalidEvidence): fake.fetch()
        fake = FakeGitHub(archive_of(INTENT)); fake.meta['workflow_run']['head_sha'] = 'b' * 40
        with self.assertRaises(a.InvalidEvidence): fake.fetch()
        fake = FakeGitHub(archive_of(INTENT)); fake.meta['workflow_run']['id'] = 124
        with self.assertRaises(a.InvalidEvidence): fake.fetch()
    def test_archive_payload_must_match_run_and_attempt(self):
        for key, bad in [('run_id', '124'), ('attempt', '2'), ('commit', 'b' * 40), ('project', 'other')]:
            fake = FakeGitHub(archive_of({**INTENT, key: bad}))
            with self.subTest(key=key), self.assertRaises(a.InvalidEvidence): fake.fetch()
    def test_wrong_digest_or_unapproved_host_cannot_pass(self):
        fake = FakeGitHub(archive_of(INTENT)); fake.archive = b'different'
        with self.assertRaises(a.InvalidEvidence): fake.fetch()
        fake = FakeGitHub(archive_of(INTENT)); fake.location = 'https://attacker.example/archive'
        with self.assertRaises(a.InvalidEvidence): fake.fetch()
        self.assertEqual(len(fake.calls), 2)
    def test_reject_extra_path_symlink_and_invalid_archive(self):
        bad = [archive_of(INTENT, '../intent.json'), archive_of(INTENT, mode=stat.S_IFLNK | 0o777), b'not zip']
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as z:
            z.writestr('intent.json', '{}'); z.writestr('extra', '{}')
        bad.append(output.getvalue())
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as z:
            z.writestr('intent.json', '{"run_id":"123","run_id":"124"}')
        bad.append(output.getvalue())
        for value in bad:
            with self.subTest(size=len(value)), self.assertRaises(a.InvalidEvidence):
                a.parse_archive(value, 'intent.json')
    def test_candidate_binding_requires_create_id_and_real_git_identity(self):
        dep = {'id': 'dpl_new', 'projectId': a.w.PROJECT, 'target': 'production',
               'meta': {'sunrise_run_id': '123', 'sunrise_run_attempt': '1', 'sunrise_commit': INTENT['commit']},
               'gitSource': {'type': 'github', 'org': 'jerry200176-png', 'repo': 'sunrise-cafe', 'ref': 'main', 'sha': INTENT['commit']}}
        record = a.bind_candidate(INTENT, {'id': 'dpl_new'}, dep)
        self.assertEqual(a.authenticate_candidate(INTENT, record, dep), 'dpl_new')
        for bad in ({**dep, 'id': 'dpl_wrong'}, {**dep, 'projectId': 'wrong'}, {**dep, 'target': 'preview'},
                    {**dep, 'gitSource': {**dep['gitSource'], 'sha': 'b' * 40}}):
            with self.assertRaises(a.InvalidEvidence): a.bind_candidate(INTENT, {'id': 'dpl_new'}, bad)
    def test_candidate_record_from_other_attempt_is_rejected(self):
        record = {'version': 1, 'run_id': '123', 'attempt': '2', 'commit': INTENT['commit'],
                  'baseline': 'dpl_base', 'candidate': 'dpl_new', 'project': a.w.PROJECT}
        with self.assertRaises(a.InvalidEvidence): a.validate_candidate(INTENT, record)
    def test_verified_candidate_archive_is_rebound_to_deployment(self):
        dep = {'id': 'dpl_new', 'projectId': a.w.PROJECT, 'target': 'production',
               'meta': {'sunrise_run_id': '123', 'sunrise_run_attempt': '1', 'sunrise_commit': INTENT['commit']},
               'gitSource': {'type': 'github', 'org': 'jerry200176-png', 'repo': 'sunrise-cafe', 'ref': 'main', 'sha': INTENT['commit']}}
        record = a.bind_candidate(INTENT, {'id': 'dpl_new'}, dep)
        fake = FakeGitHub(archive_of(record, 'candidate.json'), prefix='api-release-candidate')
        downloaded = fake.api().fetch('456', '123', '1', INTENT['commit'], fake.digest,
                                      prefix='api-release-candidate', intent=INTENT)
        self.assertEqual(a.authenticate_candidate(INTENT, downloaded, dep), 'dpl_new')
        with self.assertRaises(a.InvalidEvidence):
            a.authenticate_candidate(INTENT, downloaded, {**dep, 'id': 'dpl_other'})
    def test_candidate_record_is_exclusive_and_bound_before_persisting(self):
        dep = {'id': 'dpl_new', 'projectId': a.w.PROJECT, 'target': 'production',
               'meta': {'sunrise_run_id': '123', 'sunrise_run_attempt': '1', 'sunrise_commit': INTENT['commit']},
               'gitSource': {'type': 'github', 'org': 'jerry200176-png', 'repo': 'sunrise-cafe', 'ref': 'main', 'sha': INTENT['commit']}}
        with tempfile.TemporaryDirectory(prefix='sunrise-candidate-') as tmp:
            path = pathlib.Path(tmp) / 'candidate.json'
            with self.assertRaises(a.InvalidEvidence): a.persist_candidate(path, INTENT, {'id': 'dpl_other'}, dep)
            self.assertFalse(path.exists())
            record = a.persist_candidate(path, INTENT, {'id': 'dpl_new'}, dep)
            self.assertEqual(json.loads(path.read_text()), record)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError): a.persist_candidate(path, INTENT, {'id': 'dpl_new'}, dep)
            (pathlib.Path(tmp) / 'link').symlink_to(pathlib.Path(tmp), target_is_directory=True)
            with self.assertRaises(OSError):
                a.persist_candidate(pathlib.Path(tmp) / 'link' / 'candidate.json', INTENT, {'id': 'dpl_new'}, dep)
    def test_two_remote_artifacts_recover_bound_candidate(self):
        dep = {'id': 'dpl_new', 'projectId': a.w.PROJECT, 'target': 'production',
               'meta': {'sunrise_run_id': '123', 'sunrise_run_attempt': '1', 'sunrise_commit': INTENT['commit']},
               'gitSource': {'type': 'github', 'org': 'jerry200176-png', 'repo': 'sunrise-cafe', 'ref': 'main', 'sha': INTENT['commit']}}
        record = a.bind_candidate(INTENT, {'id': 'dpl_new'}, dep)
        intent_gh = FakeGitHub(archive_of(INTENT))
        candidate_gh = FakeGitHub(archive_of(record, 'candidate.json'), prefix='api-release-candidate')
        class ArtifactPair:
            def fetch(self, artifact_id, *args, **kwargs):
                if artifact_id == '456': return intent_gh.api().fetch(artifact_id, *args, **kwargs)
                if artifact_id == '457':
                    candidate_gh.meta['id'] = 457
                    def request(req, timeout):
                        if req.full_url.endswith('/457'): return 200, {}, json.dumps(candidate_gh.meta).encode()
                        if req.full_url.endswith('/457/zip'): return 302, {'Location': candidate_gh.location}, b''
                        return 200, {}, candidate_gh.archive
                    return a.GitHubArtifacts('synthetic', ['artifact.example'], request).fetch(artifact_id, *args, **kwargs)
                raise a.InvalidEvidence('unknown artifact')
        intent, candidate = a.bind_remote_candidate(ArtifactPair(), lambda _: dep, '123', '1', INTENT['commit'],
                                                     '456', intent_gh.digest, '457', candidate_gh.digest)
        self.assertEqual(intent, INTENT); self.assertEqual(candidate, 'dpl_new')
        with self.assertRaises(a.InvalidEvidence):
            a.bind_remote_candidate(ArtifactPair(), lambda _: {**dep, 'id': 'dpl_other'}, '123', '1', INTENT['commit'],
                                    '456', intent_gh.digest, '457', candidate_gh.digest)


if __name__ == '__main__': unittest.main()
