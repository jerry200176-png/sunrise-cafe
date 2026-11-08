import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / '.github/workflows/identity-recovery-canary.yml'


def workflow(path=WORKFLOW):
    js = "const fs=require('fs'),y=require('js-yaml');process.stdout.write(JSON.stringify(y.load(fs.readFileSync(process.argv[1],'utf8'))))"
    return json.loads(subprocess.check_output(['node', '-e', js, str(path)], cwd=ROOT))


class CancellationCanaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.env = {'PATH': os.defpath, 'RUNNER_TEMP': self.temp.name,
                    'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '2',
                    'RELEASE_RESULT': 'cancelled', 'PREPARE_OUTCOME': 'success',
                    'BASELINE_OUTCOME': 'cancelled', 'CREATE_OUTCOME': 'skipped'}

    def observe(self, **changes):
        return subprocess.run(['python3', '-B', str(ROOT / 'scripts/identity-recovery-canary.py'),
                               'observe-cancellation'], env={**self.env, **changes},
                              capture_output=True, text=True, timeout=15)

    def test_native_producer_and_always_observer_wiring(self):
        w = workflow()
        producer, observer = (w['jobs'][name] for name in ('cancellation-producer', 'observe-cancellation'))
        self.assertEqual(w['permissions'], {})
        self.assertEqual(set(w['on']), {'pull_request'})
        for job in (producer, observer):
            self.assertEqual(job['runs-on'], 'ubuntu-latest')
            self.assertEqual(job['timeout-minutes'], 5)
            self.assertNotIn('continue-on-error', job)
        self.assertNotIn('permissions', producer)
        self.assertTrue(all('uses' not in step and 'if' not in step for step in producer['steps']))
        self.assertEqual(producer['outputs'], {key: '${{ steps.' + key + '.outcome }}'
                                               for key in ('prepare', 'baseline', 'create')})
        self.assertEqual([step['id'] for step in producer['steps']], ['prepare', 'baseline', 'create'])
        barrier = producer['steps'][1]
        self.assertEqual(barrier['name'], 'Hold synthetic pre-create barrier (180 seconds)')
        self.assertEqual(barrier['run'].splitlines()[-1], 'sleep 180')
        self.assertEqual(observer['needs'], 'cancellation-producer')
        self.assertEqual(observer['if'], '${{ always() }}')
        self.assertEqual(observer['permissions'], {'contents': 'read'})
        self.assertEqual(observer['steps'][0]['uses'], 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1')
        self.assertEqual(observer['steps'][0]['with'], {'persist-credentials': False})
        step = observer['steps'][1]
        self.assertEqual(step['run'], 'python3 -B scripts/identity-recovery-canary.py observe-cancellation')
        self.assertEqual(step['env'], {'RELEASE_RESULT': '${{ needs.cancellation-producer.result }}',
                                     **{key.upper() + '_OUTCOME': '${{ needs.cancellation-producer.outputs.' + key + ' }}'
                                        for key in ('prepare', 'baseline', 'create')}})
        for forbidden in ('secrets.', 'github.token', 'actions: read', 'VERCEL_TOKEN', 'SUPABASE', 'GH_TOKEN'):
            self.assertNotIn(forbidden, json.dumps(w))

    def test_normal_completion_passes_without_recovery(self):
        result = self.observe(RELEASE_RESULT='success', BASELINE_OUTCOME='success', CREATE_OUTCOME='success')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('production recovery is not required', result.stdout)
        self.assertNotIn('recovery entered', result.stdout)

    def test_cancelled_and_absent_outputs_use_exact_classifier_and_refuse_unknown_ownership(self):
        production = workflow(ROOT / '.github/workflows/production-code-only.yml')
        classifier = next(step['run'] for step in production['jobs']['recovery']['steps'] if step.get('id') == 'phase')
        for changes in ({}, {'PREPARE_OUTCOME': '', 'BASELINE_OUTCOME': '', 'CREATE_OUTCOME': ''}):
            with self.subTest(changes=changes):
                result = self.observe(**changes)
                self.assertEqual(result.returncode, 0, result.stderr)
                line = next(line for line in result.stdout.splitlines() if line.startswith('Synthetic phase evidence: '))
                evidence = json.loads(line.removeprefix('Synthetic phase evidence: '))
                self.assertEqual(evidence['classifier_sha256'], hashlib.sha256(classifier.encode()).hexdigest())
                self.assertEqual((evidence['run_id'], evidence['attempt'], evidence['RELEASE_RESULT']), ('123', '2', 'cancelled'))
                self.assertEqual(evidence['pre_create'], 'pre_create=false')
                self.assertIn('recovery entered; missing identity refused unknown ownership; no rollback', result.stdout)

    def test_unplanned_failure_or_attempted_create_cannot_claim_cancellation_proof(self):
        for changes in ({'RELEASE_RESULT': 'failure'}, {'RELEASE_RESULT': ''},
                        {'CREATE_OUTCOME': 'success'}, {'CREATE_OUTCOME': 'cancelled'},
                        {'RELEASE_RESULT': 'success', 'BASELINE_OUTCOME': 'success', 'CREATE_OUTCOME': ''}):
            with self.subTest(changes=changes):
                result = self.observe(**changes)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('recovery entered', result.stdout)


class IdentityCanaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.w = workflow()
        self.env = {'PATH': os.defpath, 'RUNNER_TEMP': str(self.root),
                    'GITHUB_OUTPUT': str(self.root / 'output'),
                    'BASELINE_ID': '1', 'CANDIDATE_ID': '2',
                    'BASELINE_DIGEST': 'a' * 64, 'CANDIDATE_DIGEST': 'b' * 64,
                    'CANARY_OUTPUT_ID': 'dpl_syntheticcandidate', 'CANARY_OUTPUT_COMMIT': 'a' * 40}
        self.addCleanup(self.temp.cleanup)

    def create_downloads(self):
        script = self.w['jobs']['upload']['steps'][0]['run']
        result = subprocess.run(['bash', '-c', script], env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        outputs = dict(line.split('=', 1) for line in (self.root / 'output').read_text().splitlines())
        self.assertEqual(outputs, {'candidate': self.env['CANARY_OUTPUT_ID'], 'commit': self.env['CANARY_OUTPUT_COMMIT']})
        shutil.copytree(self.root / 'identity-recovery-fixtures', self.root / 'identity-recovery-downloaded')

    def verify(self):
        return subprocess.run(['python3', '-B', str(ROOT / 'scripts/identity-recovery-canary.py')],
                              env=self.env, capture_output=True, text=True)

    def test_pr_only_permissions_and_no_user_credentials(self):
        self.assertEqual(set(self.w['on']), {'pull_request'})
        self.assertEqual(self.w['permissions'], {})
        upload, verify = self.w['jobs']['upload'], self.w['jobs']['verify']
        self.assertNotIn('permissions', upload)
        self.assertEqual(verify['permissions'], {'contents': 'read'})
        self.assertEqual(verify['needs'], 'upload')
        self.assertNotIn('env', upload)
        self.assertNotIn('env', verify)
        self.assertEqual(len(verify['steps']), 4)
        for job in (upload, verify):
            self.assertEqual(job['runs-on'], 'ubuntu-latest')
            self.assertEqual(job['timeout-minutes'], 10)
        checkout = verify['steps'][0]
        self.assertEqual(checkout['with'], {'persist-credentials': False})
        self.assertEqual(checkout['uses'], 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1')
        self.assertEqual(verify['steps'][-1]['run'], 'python3 -B scripts/identity-recovery-canary.py')
        for forbidden in ('secrets.', 'github.token', 'actions: read', 'VERCEL_TOKEN', 'SUPABASE', 'GH_TOKEN'):
            self.assertNotIn(forbidden, json.dumps(self.w))

    def test_phase_probes_are_synthetic_and_verifier_rejects_missing_outcomes(self):
        for name in ('phase-prepare-failure', 'phase-baseline-failure'):
            job = self.w['jobs'][name]
            self.assertEqual(job['runs-on'], 'ubuntu-latest')
            self.assertEqual(job['timeout-minutes'], 5)
            self.assertTrue(job['continue-on-error'])
            self.assertNotIn('permissions', job)
            self.assertEqual(job['outputs'], {key: '${{ steps.' + key + '.outcome }}'
                                              for key in ('prepare', 'baseline', 'create')})
            self.assertTrue(all('uses' not in step for step in job['steps']))
        verifier = self.w['jobs']['verify-phase-outputs']
        self.assertEqual(verifier['needs'], ['phase-prepare-failure', 'phase-baseline-failure'])
        self.assertEqual(verifier['if'], '${{ always() }}')
        self.assertNotIn('permissions', verifier)
        script = verifier['steps'][0]['run']
        env = {'PATH': os.defpath, 'PREPARE_FAILED_PREPARE': 'failure',
               'PREPARE_FAILED_BASELINE': 'skipped', 'PREPARE_FAILED_CREATE': 'skipped',
               'BASELINE_FAILED_PREPARE': 'success', 'BASELINE_FAILED_BASELINE': 'failure',
               'BASELINE_FAILED_CREATE': 'skipped'}
        self.assertEqual(subprocess.run(['bash', '-c', script], env=env, capture_output=True).returncode, 0)
        for key in env.keys() - {'PATH'}:
            self.assertNotEqual(subprocess.run(['bash', '-c', script], env={**env, key: ''}, capture_output=True).returncode, 0)

    def test_artifact_actions_names_inputs_and_output_wiring(self):
        upload, verify = self.w['jobs']['upload'], self.w['jobs']['verify']
        self.assertEqual(len(upload['steps']), 3)
        for key, expression in {'candidate-output':'${{ steps.fixtures.outputs.candidate }}', 'candidate-commit':'${{ steps.fixtures.outputs.commit }}'}.items():
            self.assertEqual(upload['outputs'][key], expression)
        expected_env = {'BASELINE_ID':'baseline-id', 'BASELINE_DIGEST':'baseline-digest', 'CANDIDATE_ID':'candidate-id', 'CANDIDATE_DIGEST':'candidate-digest', 'CANARY_OUTPUT_ID':'candidate-output', 'CANARY_OUTPUT_COMMIT':'candidate-commit'}
        for key, output in expected_env.items():
            self.assertEqual(verify['steps'][-1]['env'][key], '${{ needs.upload.outputs.' + output + ' }}')
        for i, kind in enumerate(('baseline', 'candidate'), 1):
            step, download = upload['steps'][i], verify['steps'][i]
            name = f'identity-canary-{kind}-${{{{ github.run_id }}}}-${{{{ github.run_attempt }}}}'
            self.assertEqual(step['uses'], 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9')
            self.assertEqual(step['with']['name'], name)
            self.assertEqual(step['with']['path'], '${{ runner.temp }}/identity-recovery-fixtures/sunrise-code-only-' + kind + '.json')
            self.assertEqual(upload['outputs'][kind + '-id'], '${{ steps.' + kind + '.outputs.artifact-id }}')
            self.assertEqual(upload['outputs'][kind + '-digest'], '${{ steps.' + kind + '.outputs.artifact-digest }}')
            self.assertEqual(step['with']['retention-days'], 7)
            self.assertEqual(step['with']['if-no-files-found'], 'error')
            self.assertNotIn('archive', step['with'])  # exercise the v7 default, like #557
            self.assertEqual(download['uses'], 'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093')
            self.assertEqual(download['with']['name'], name)
            self.assertEqual(download['with']['path'], '${{ runner.temp }}/identity-recovery-downloaded')

    def test_fixture_and_offline_fake_recovery(self):
        self.create_downloads()
        result = self.verify()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Synthetic artifact identity and fake recovery: PASS', result.stdout)

    def test_tampered_and_missing_artifacts_fail_closed(self):
        self.create_downloads()
        base = self.root / 'identity-recovery-downloaded/sunrise-code-only-baseline.json'
        base.write_text('{"baseline":"dpl_other","previous":"' + 'b'*40 + '","commit":"' + 'a'*40 + '"}')
        self.assertNotEqual(self.verify().returncode, 0)
        base.unlink()
        self.assertNotEqual(self.verify().returncode, 0)

    def test_invalid_upload_outputs_fail_before_fake_recovery(self):
        self.create_downloads()
        for changes in ({'BASELINE_ID':'2'}, {'CANDIDATE_ID':''}, {'BASELINE_DIGEST':'bad'},
                        {'CANARY_OUTPUT_ID':'dpl_other'}, {'CANARY_OUTPUT_COMMIT':'b'*40}):
            old = dict(self.env); self.env.update(changes)
            self.assertNotEqual(self.verify().returncode, 0)
            self.env = old

    def test_socket_connections_are_disabled(self):
        source = "import runpy,socket;runpy.run_path('scripts/identity-recovery-canary.py');socket.socket().connect(('198.51.100.1',443))"
        result = subprocess.run(['python3', '-B', '-c', source], cwd=ROOT, env={'PATH': os.defpath}, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Network is disabled', result.stderr)


if __name__ == '__main__':
    unittest.main()
