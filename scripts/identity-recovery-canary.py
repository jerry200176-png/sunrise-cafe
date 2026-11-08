#!/usr/bin/env python3
"""Run only synthetic artifact identities against real recovery logic and fake APIs."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tempfile


def no_network(*_args, **_kwargs):
    raise RuntimeError('Network is disabled for the synthetic recovery canary')


# No real Vercel, GitHub, database, DNS, or other network call is permitted.
socket.socket.connect = no_network
socket.socket.connect_ex = no_network
socket.create_connection = no_network
socket.getaddrinfo = no_network
root = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('release', root / 'code-only-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

SHA = 'a' * 40
OLD = 'b' * 40
BASE = 'dpl_syntheticbaseline'
NEW = 'dpl_syntheticcandidate'
BASEFILE = 'sunrise-code-only-baseline.json'
NEWFILE = 'sunrise-code-only-candidate.json'


class FakeAPI:
    def __init__(self):
        self.current = NEW
        self.rollbacks = []
    def alias(self): return self.current
    def deployment(self, ident):
        if ident != NEW: raise AssertionError('unexpected synthetic deployment')
        return {'readyState': 'READY'}
    def rollback(self, ident):
        if ident != BASE: raise AssertionError('unexpected synthetic rollback target')
        self.rollbacks.append(ident)
        self.current = ident
    def cancel(self, _ident): raise AssertionError('unexpected synthetic cancel')


class FakeHTTP:
    def __init__(self, api): self.api = api
    def request(self, host, path):
        if host != release.HOST or self.api.current != BASE:
            raise AssertionError('unexpected synthetic health request')
        if path == '/api/version': return 200, {'commit': OLD}, b'{}'
        if path == '/api/booking-health': return 200, {'ok': True}, b'{}'
        if path == '/': return 200, None, b'<synthetic/>'
        raise AssertionError('unexpected synthetic health path')


def run_recovery(directory, api, output_id, output_commit):
    record = release.read_record(directory / BASEFILE)
    if record['commit'] != SHA: raise release.Unknown('release record commit mismatch')
    candidate = release.recovery_candidate(directory / NEWFILE, SHA, output_id, output_commit)
    return release.recover(api, FakeHTTP(api), record, candidate,
                           clock=lambda: 0, sleep=lambda _delay: None, seconds=1)


def expect_rejection(directory, output_id, output_commit, *, current=NEW):
    api = FakeAPI()
    api.current = current
    try:
        run_recovery(directory, api, output_id, output_commit)
    except (release.Unknown, FileNotFoundError, ValueError, TypeError):
        if api.rollbacks: raise AssertionError('refused recovery attempted rollback')
        return
    raise AssertionError('invalid synthetic identity was not rejected')


def production_classifier():
    source = (root.parent / '.github/workflows/production-code-only.yml').read_text()
    marker = '      - name: Classify proven pre-create failure\n'
    if source.count(marker) != 1:
        raise AssertionError('production phase classifier missing or ambiguous')
    step = source.split(marker)[1].split('\n      - ', 1)[0]
    header, body = step.split('        run: |\n')
    if '        id: phase\n' not in header or not body.strip():
        raise AssertionError('production phase classifier shape changed')
    lines = body.splitlines()
    if any(line and not line.startswith('          ') for line in lines):
        raise AssertionError('production phase classifier indentation changed')
    return '\n'.join(line[10:] for line in lines) + '\n'


def observe_cancellation():
    keys = ('RELEASE_RESULT', 'PREPARE_OUTCOME', 'BASELINE_OUTCOME', 'CREATE_OUTCOME')
    values = {key: os.environ.get(key, '') for key in keys}
    classifier = production_classifier()
    evidence = {'run_id': os.environ.get('GITHUB_RUN_ID', ''),
                'attempt': os.environ.get('GITHUB_RUN_ATTEMPT', ''), **values,
                'classifier_sha256': hashlib.sha256(classifier.encode()).hexdigest()}
    with tempfile.TemporaryDirectory(dir=os.environ['RUNNER_TEMP']) as temp:
        work = Path(temp)
        output = work / 'phase-output'
        result = subprocess.run(['bash', '-c', classifier],
                                env={'PATH': os.defpath, **values, 'GITHUB_OUTPUT': str(output)},
                                capture_output=True, text=True, timeout=10, check=True)
        print(result.stdout, end='')
        phase = output.read_text()
        evidence['pre_create'] = phase.strip()
        print('Synthetic phase evidence: ' + json.dumps(evidence, sort_keys=True), flush=True)
        if phase != 'pre_create=false\n':
            raise AssertionError('success or cancellation unexpectedly bypassed recovery')
        if values['RELEASE_RESULT'] == 'success':
            if any(values[key] != 'success' for key in keys[1:]):
                raise AssertionError('successful producer has inconsistent phase evidence')
            print('Synthetic producer completed; production recovery is not required.')
            return
        if values['RELEASE_RESULT'] != 'cancelled':
            raise AssertionError('producer did not complete or receive native cancellation')
        if values['CREATE_OUTCOME'] not in ('', 'skipped'):
            raise AssertionError('producer was not cancelled before synthetic create')
        # The observer's synthetic baseline is not a retained producer artifact.
        # Missing candidate identity must reach real recovery, then refuse ownership.
        (work / BASEFILE).write_text(json.dumps({'baseline': BASE, 'previous': OLD, 'commit': SHA}))
        api = FakeAPI()
        try:
            run_recovery(work, api, '', '')
        except release.Unknown as error:
            if str(error) != 'production deployment ownership is unknown' or api.rollbacks:
                raise AssertionError('unexpected fake recovery refusal') from error
        else:
            raise AssertionError('missing candidate identity did not refuse fake recovery')
        print('Synthetic cancelled producer: recovery entered; missing identity refused unknown ownership; no rollback.')


def main():
    ids = [os.environ.get('BASELINE_ID', ''), os.environ.get('CANDIDATE_ID', '')]
    digests = [os.environ.get('BASELINE_DIGEST', ''), os.environ.get('CANDIDATE_DIGEST', '')]
    if (not all(re.fullmatch(r'[1-9][0-9]*', value) for value in ids) or ids[0] == ids[1]
            or not all(re.fullmatch(r'[0-9a-f]{64}', value) for value in digests)):
        raise AssertionError('synthetic upload outputs invalid')
    output_id = os.environ.get('CANARY_OUTPUT_ID', '')
    output_commit = os.environ.get('CANARY_OUTPUT_COMMIT', '')
    if output_id != NEW or output_commit != SHA: raise AssertionError('synthetic job output invalid')
    downloaded = Path(os.environ['RUNNER_TEMP']) / 'identity-recovery-downloaded'
    if not downloaded.is_dir() or {p.name for p in downloaded.iterdir()} != {BASEFILE, NEWFILE}:
        raise AssertionError('synthetic artifact filenames invalid')
    for path in (downloaded / BASEFILE, downloaded / NEWFILE):
        if path.is_symlink() or not path.is_file(): raise AssertionError('synthetic artifact file invalid')
    record = release.read_record(downloaded / BASEFILE)
    if record != {'baseline': BASE, 'previous': OLD, 'commit': SHA}:
        raise AssertionError('synthetic baseline content invalid')
    if release.read_candidate(downloaded / NEWFILE, SHA) != NEW:
        raise AssertionError('synthetic candidate content invalid')

    with tempfile.TemporaryDirectory(dir=os.environ['RUNNER_TEMP']) as temp:
        work = Path(temp)
        def case(name):
            target = work / name
            shutil.copytree(downloaded, target)
            return target
        good = case('good'); api = FakeAPI()
        if run_recovery(good, api, output_id, output_commit) != 'rolled-back' or api.rollbacks != [BASE]:
            raise AssertionError('matching synthetic identities did not roll back fake candidate')
        conflict = case('conflict')
        expect_rejection(conflict, 'dpl_othercandidate', output_commit)
        wrong_commit = case('wrong-commit')
        expect_rejection(wrong_commit, output_id, OLD)
        other_live = case('other-live')
        expect_rejection(other_live, output_id, output_commit, current='dpl_othercandidate')
        wrong_record = case('wrong-record')
        (wrong_record / BASEFILE).write_text('{"baseline":"' + BASE + '","previous":"' + OLD + '","commit":"' + OLD + '"}')
        expect_rejection(wrong_record, output_id, output_commit)
        wrong_candidate = case('wrong-candidate')
        (wrong_candidate / NEWFILE).write_text('{"deployment":"' + NEW + '","commit":"' + OLD + '"}')
        expect_rejection(wrong_candidate, output_id, output_commit)
        missing_base = case('missing-baseline'); (missing_base / BASEFILE).unlink()
        expect_rejection(missing_base, output_id, output_commit)
        missing_candidate = case('missing-candidate'); (missing_candidate / NEWFILE).unlink()
        expect_rejection(missing_candidate, '', '')
        api = FakeAPI()
        if run_recovery(missing_candidate, api, output_id, output_commit) != 'rolled-back' or api.rollbacks != [BASE]:
            raise AssertionError('synthetic job-output fallback failed')
    print('Synthetic artifact identity and fake recovery: PASS')


if __name__ == '__main__':
    if sys.argv[1:] == ['observe-cancellation']:
        observe_cancellation()
    elif sys.argv[1:]:
        raise SystemExit('invalid canary mode')
    else:
        main()
