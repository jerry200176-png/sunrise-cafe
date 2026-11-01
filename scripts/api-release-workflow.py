#!/usr/bin/env python3
"""Research integration of write-ahead, release and independent recovery.

All platform access requires injected adapters. CLI stops before configuration,
credentials or network. D8/D2/D3 and real health/incident prerequisites remain
unimplemented; this module is not a deployable release command.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import uuid


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module


artifacts = load('api_release_artifacts', 'api-release-artifacts.py')
w = artifacts.w
RELEASE_ENABLED = False
PREREQUISITES_VERIFIED = False
MAX_RECORD = 4096


def ensure_directory(root, name):
    if not re.fullmatch(r'sunrise-api-release-[a-z-]+', name):
        raise ValueError('invalid release directory')
    parent = w.open_safe_directory(root)
    try:
        try:
            os.mkdir(name, 0o700, dir_fd=parent)
            os.fsync(parent)
        except FileExistsError:
            pass
        directory = os.open(name, os.O_RDONLY | os.O_DIRECTORY | getattr(os, 'O_NOFOLLOW', 0), dir_fd=parent)
        os.close(directory)
    finally:
        os.close(parent)
    return Path(root) / name


def verify_checkout(sha, tree, ref):
    if (not isinstance(sha, str) or not w.SHA.fullmatch(sha) or not isinstance(tree, str)
            or not w.SHA.fullmatch(tree) or ref != 'refs/heads/main'):
        raise ValueError('invalid release source')
    def git(*args):
        result = subprocess.run(['git', *args], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False)
        if result.returncode: raise ValueError('release source unavailable')
        return result.stdout.decode('utf-8').strip()
    if git('rev-parse', 'HEAD') != sha or git('rev-parse', 'HEAD^{tree}') != tree:
        raise ValueError('release checkout identity mismatch')
    if git('status', '--porcelain', '--untracked-files=all'):
        raise ValueError('release checkout is not clean')


def incident_writer(root, run_id, attempt):
    directory = ensure_directory(root, 'sunrise-api-release-incidents')
    def record(reason, baseline):
        if not re.fullmatch(r'[a-z-]{1,64}', reason): raise ValueError('invalid incident')
        if baseline != 'unknown' and not w.DEPLOYMENT.fullmatch(baseline): raise ValueError('invalid baseline')
        parent = w.open_safe_directory(directory)
        try:
            name = uuid.uuid4().hex + '.json'
            descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600, dir_fd=parent)
            with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
                json.dump({'reason': reason, 'baseline': baseline, 'run_id': run_id, 'attempt': attempt}, output)
                output.write('\n'); output.flush(); os.fsync(output.fileno())
            os.fsync(parent)
        finally:
            os.close(parent)
    return record


def read_record(path):
    path = Path(path)
    directory = w.open_safe_directory(path.parent)
    try:
        descriptor = os.open(path.name, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0), dir_fd=directory)
    finally:
        os.close(directory)
    with os.fdopen(descriptor, 'rb') as file:
        metadata = os.fstat(file.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_size > MAX_RECORD:
            raise ValueError('invalid release record')
        raw = file.read(MAX_RECORD + 1)
    value = json.loads(raw, object_pairs_hook=artifacts.strict_object)
    if not isinstance(value, dict): raise ValueError('invalid release record')
    return value


class Context:
    def __init__(self, api, github, health, incident, run_id, attempt, sha, *, runner_temp,
                 clock=time.monotonic, sleep=time.sleep, wait_seconds=180, poll_seconds=2):
        self.api, self.github, self.health, self.incident = api, github, health, incident
        self.run_id, self.attempt, self.sha = run_id, attempt, sha
        self.runner_temp = Path(runner_temp)
        self.clock, self.sleep = clock, sleep
        self.wait_seconds, self.poll_seconds = wait_seconds, poll_seconds

    def record(self, reason, baseline):
        try:
            self.incident(reason, baseline)
        except Exception:
            return False
        return True

    def prepare(self, path):
        baseline = self.api.production_alias()
        intent = {'version': 1, 'intent': 'code-only-release', 'run_id': self.run_id,
                  'attempt': self.attempt, 'commit': self.sha, 'baseline': baseline, 'project': w.PROJECT}
        w.write_intent(path, intent)
        return intent

    def load_intent(self, path):
        intent = w.validate(read_record(path))
        if (intent['run_id'], intent['attempt'], intent['commit']) != (self.run_id, self.attempt, self.sha):
            raise ValueError('release intent differs from workflow')
        return intent

    def create(self, intent_path, candidate_path, *, intent_id, intent_digest):
        intent = self.load_intent(intent_path)
        try:
            remote = self.github.fetch(intent_id, self.run_id, self.attempt, self.sha, intent_digest)
            if remote != intent:
                raise ValueError('write-ahead artifact does not match')
        except Exception:
            return 'unknown' if self.record('write-ahead-unverified', intent['baseline']) else 'incident-unwritten'
        try:
            live = self.api.production_alias()
        except Exception:
            return 'unknown' if self.record('baseline-unavailable', intent['baseline']) else 'incident-unwritten'
        if live != intent['baseline']:
            return 'unknown' if self.record('baseline-changed', intent['baseline']) else 'incident-unwritten'
        try:
            # Fixed to the trusted runner temp and run/attempt, independent of
            # candidate_path. This is not a cross-runner writer fence.
            parent = w.open_safe_directory(self.runner_temp)
            try:
                try:
                    os.mkdir('sunrise-api-release-claims', 0o700, dir_fd=parent)
                    os.fsync(parent)
                except FileExistsError:
                    pass
                directory = os.open('sunrise-api-release-claims', os.O_RDONLY | os.O_DIRECTORY |
                                    getattr(os, 'O_NOFOLLOW', 0), dir_fd=parent)
                try:
                    w.write_intent_at(directory, f'run-{self.run_id}-{self.attempt}.json', intent)
                finally:
                    os.close(directory)
            finally:
                os.close(parent)
        except Exception:
            return 'unknown' if self.record('create-claim-unavailable', intent['baseline']) else 'incident-unwritten'
        try:
            # Do not retry: a failed response can still have changed traffic.
            candidate = self.api.create_production(self.sha, self.run_id, self.attempt)
            deadline = self.clock() + self.wait_seconds
            while True:
                try:
                    if self.clock() >= deadline: raise TimeoutError('candidate deadline expired')
                    deployment = self.api.deployment(candidate, deadline=deadline)
                    if self.clock() >= deadline: raise TimeoutError('candidate deadline expired')
                    break
                except Exception:
                    remaining = deadline - self.clock()
                    if remaining <= 0:
                        raise
                    self.sleep(min(self.poll_seconds, remaining))
            artifacts.persist_candidate(candidate_path, intent, {'id': candidate}, deployment)
            return 'candidate-recorded'
        except Exception:
            incident_ok = self.record('production-outcome-unknown', intent['baseline'])
            try:
                # Reconcile only through reads. Never repeat the create POST.
                candidate, deployment = self.api.find_candidate(
                    self.sha, self.run_id, self.attempt, deadline=self.clock() + self.wait_seconds)
                artifacts.persist_candidate(candidate_path, intent, {'id': candidate}, deployment)
            except Exception:
                pass
            return 'unknown' if incident_ok else 'incident-unwritten'

    def verify(self, intent_id, intent_digest, candidate_id, candidate_digest):
        try:
            intent, candidate = artifacts.bind_remote_candidate(
                self.github, self.api.deployment, self.run_id, self.attempt, self.sha,
                intent_id, intent_digest, candidate_id, candidate_digest)
        except Exception:
            return 'unknown' if self.record('verification-evidence-unknown', 'unknown') else 'incident-unwritten'
        try:
            deadline = self.clock() + self.wait_seconds
            while True:
                if self.clock() >= deadline:
                    return 'unknown' if self.record('production-still-in-flight', intent['baseline']) else 'incident-unwritten'
                deployment = self.api.deployment(candidate, deadline=deadline)
                if self.clock() >= deadline:
                    return 'unknown' if self.record('production-still-in-flight', intent['baseline']) else 'incident-unwritten'
                artifacts.bind_candidate(intent, {'id': candidate}, deployment)
                state = deployment.get('readyState')
                live = self.api.production_alias(deadline=deadline)
                if self.clock() >= deadline:
                    return 'unknown' if self.record('production-still-in-flight', intent['baseline']) else 'incident-unwritten'
                if live not in (candidate, intent['baseline']):
                    return 'unknown' if self.record('live-alias-not-candidate', intent['baseline']) else 'incident-unwritten'
                if state == 'READY' and live == candidate:
                    break
                if state in ('ERROR', 'CANCELED', 'CANCELLED'):
                    return 'unknown' if self.record('production-build-failed', intent['baseline']) else 'incident-unwritten'
                remaining = deadline - self.clock()
                if remaining <= 0:
                    return 'unknown' if self.record('production-still-in-flight', intent['baseline']) else 'incident-unwritten'
                self.sleep(min(self.poll_seconds, remaining))
            try:
                if self.health(candidate, self.sha, deadline=deadline) is True:
                    if self.clock() >= deadline:
                        return 'unknown' if self.record('production-still-in-flight', intent['baseline']) else 'incident-unwritten'
                    final_alias = self.api.production_alias(deadline=deadline)
                    if self.clock() >= deadline:
                        return 'unknown' if self.record('production-still-in-flight', intent['baseline']) else 'incident-unwritten'
                    if final_alias == candidate:
                        return 'verified'
                    return 'unknown' if self.record('live-alias-not-candidate', intent['baseline']) else 'incident-unwritten'
            except Exception:
                pass
            # Re-read immediately before rollback; it still is not atomic.
            recovery_deadline = self.clock() + 60
            before_rollback = self.api.production_alias(deadline=recovery_deadline)
            if self.clock() >= recovery_deadline:
                return 'unknown' if self.record('rollback-unconfirmed', intent['baseline']) else 'incident-unwritten'
            if before_rollback != candidate:
                return 'unknown' if self.record('live-alias-not-candidate', intent['baseline']) else 'incident-unwritten'
            incident_ok = self.record('live-verification-failed', intent['baseline'])
            try:
                self.api.rollback_request(intent['baseline'], deadline=recovery_deadline)
                if self.clock() >= recovery_deadline: raise TimeoutError('rollback deadline expired')
                first_alias = self.api.production_alias(deadline=recovery_deadline)
                if self.clock() >= recovery_deadline: raise TimeoutError('rollback deadline expired')
                healthy = self.health(intent['baseline'], None, deadline=recovery_deadline)
                if self.clock() >= recovery_deadline: raise TimeoutError('rollback deadline expired')
                final_alias = self.api.production_alias(deadline=recovery_deadline)
                if self.clock() >= recovery_deadline: raise TimeoutError('rollback deadline expired')
                if first_alias == intent['baseline'] and healthy is True and final_alias == intent['baseline']:
                    return 'rolled-back' if incident_ok else 'incident-unwritten'
            except Exception:
                pass
            rollback_incident_ok = self.record('rollback-unconfirmed', intent['baseline'])
            return 'unknown' if incident_ok and rollback_incident_ok else 'incident-unwritten'
        except Exception:
            return 'unknown' if self.record('verification-outcome-unknown', intent['baseline']) else 'incident-unwritten'

    def monitor(self, intent_id, intent_digest, candidate_id, candidate_digest):
        try:
            intent, candidate = artifacts.bind_remote_candidate(
                self.github, self.api.deployment, self.run_id, self.attempt, self.sha,
                intent_id, intent_digest, candidate_id, candidate_digest)
        except Exception:
            return 'unknown' if self.record('recovery-evidence-unknown', 'unknown') else 'incident-unwritten'
        context = self
        class Provider:
            def alias(self):
                if context.clock() >= deadline: raise TimeoutError('recovery deadline expired')
                value = context.api.production_alias(deadline=deadline)
                if context.clock() >= deadline: raise TimeoutError('recovery deadline expired')
                return value
            def health(self, deployment):
                if deployment == candidate and not ready: return None
                if context.clock() >= deadline: raise TimeoutError('recovery deadline expired')
                value = context.health(deployment, context.sha if deployment == candidate else None, deadline=deadline)
                if context.clock() >= deadline: raise TimeoutError('recovery deadline expired')
                return value
            def rollback(self, baseline):
                if context.clock() >= deadline: raise TimeoutError('recovery deadline expired')
                result = context.api.rollback_request(baseline, deadline=deadline)
                if context.clock() >= deadline: raise TimeoutError('recovery deadline expired')
                return result
        deadline = self.clock() + self.wait_seconds
        ready = False
        while True:
            if self.clock() >= deadline:
                result = 'unknown-in-flight'
                break
            try:
                deployment = self.api.deployment(candidate, deadline=deadline)
                if self.clock() >= deadline:
                    result = 'unknown-in-flight'
                    break
                artifacts.bind_candidate(intent, {'id': candidate}, deployment)
                ready = deployment.get('readyState') == 'READY'
                result = w.monitor(Provider(), intent, self.run_id, candidate, True, attempt=self.attempt)
                if result == 'observe':
                    if Provider().alias() != candidate:
                        result = 'unknown-owner'
            except Exception:
                return 'unknown' if self.record('recovery-identity-unknown', intent['baseline']) else 'incident-unwritten'
            if result != 'unknown-in-flight':
                break
            remaining = deadline - self.clock()
            if remaining <= 0:
                break
            self.sleep(min(self.poll_seconds, remaining))
        if not ready and result == 'rolled-back': result = 'unknown'
        if result != 'observe' and not self.record('monitor-' + result, intent['baseline']):
            return 'incident-unwritten'
        return result


def main():
    if not RELEASE_ENABLED:
        raise SystemExit('API workflow hard-stopped before credentials or network')
    if not PREREQUISITES_VERIFIED:
        raise SystemExit('API workflow prerequisites and live health are not implemented')
    if len(sys.argv) != 2 or sys.argv[1] not in ('--prepare', '--create', '--verify', '--monitor'):
        raise SystemExit('invalid release phase')
    try:
        env = os.environ
        sha, run_id, attempt = env.get('GITHUB_SHA', ''), env.get('GITHUB_RUN_ID', ''), env.get('GITHUB_RUN_ATTEMPT', '')
        verify_checkout(sha, env.get('REVIEWED_TREE_SHA', ''), env.get('GITHUB_REF', ''))
        if not w.RUN.fullmatch(run_id) or not w.RUN.fullmatch(attempt): raise ValueError('invalid workflow identity')
        root = env['RUNNER_TEMP']
        intent_dir = ensure_directory(root, 'sunrise-api-release-intent')
        candidate_dir = ensure_directory(root, 'sunrise-api-release-candidate')
        incident = incident_writer(root, run_id, attempt)
        adapter = load('release_api', 'api-release-adapter.py')
        health = load('release_health', 'api-release-health.py')
        api = adapter.VercelAPI(env.get('VERCEL_TOKEN', ''))
        hosts = [host for host in env.get('GITHUB_ARTIFACT_ALLOWED_HOSTS', '').split(',') if host]
        github = artifacts.GitHubArtifacts(env.get('GH_TOKEN', ''), hosts)
        if sys.argv[1] in ('--prepare', '--create'):
            source = load('release_source', 'api-release-source.py')
            source.verify(github, sha, env.get('REVIEWED_TREE_SHA', ''))
        ctx = Context(api, github, lambda deployment, expected, *, deadline=None: health.probe(api, deployment, expected, deadline=deadline),
                      incident, run_id, attempt, sha, runner_temp=root)
        intent_path, candidate_path = intent_dir / 'intent.json', candidate_dir / 'candidate.json'
        iid, idig = env.get('INTENT_ARTIFACT_ID', ''), env.get('INTENT_ARTIFACT_DIGEST', '')
        cid, cdig = env.get('CANDIDATE_ARTIFACT_ID', ''), env.get('CANDIDATE_ARTIFACT_DIGEST', '')
        if sys.argv[1] == '--prepare': ctx.prepare(intent_path); result = 'prepared'
        elif sys.argv[1] == '--create': result = ctx.create(intent_path, candidate_path, intent_id=iid, intent_digest=idig)
        elif sys.argv[1] == '--verify': result = ctx.verify(iid, idig, cid, cdig)
        else: result = ctx.monitor(iid, idig, cid, cdig)
        if result not in ('prepared', 'candidate-recorded', 'verified', 'observe'):
            raise RuntimeError('release phase did not complete safely')
        print('release phase completed:', result)
    except Exception:
        raise SystemExit('release phase failed or outcome is unknown; inspect incident evidence') from None


if __name__ == '__main__': main()
