#!/usr/bin/env python3
"""Synthetic watcher/recovery contract research; no GitHub or Vercel requests."""
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("recovery_tests", ROOT / "scripts/test_code_only_release.py")
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
r = fixtures.r

WATCH_SCRIPT = """
import { watch } from './scripts/post-deploy-watch.mjs';
const sha = 'a'.repeat(40), other = 'b'.repeat(40);
let round = 0;
const fetchImpl = async (url) => {
  if (url.endsWith('/api/version')) {
    round++;
    if (round === 3 && process.argv[1] === 'unknown')
      return { status: 503, ok: false, headers: { get: () => 'application/json' }, json: async () => ({}) };
    return { status: 200, ok: true, headers: { get: () => 'application/json' },
      json: async () => ({ commit: round === 3 && process.argv[1] === 'superseded' ? other : sha }) };
  }
  return { status: url.includes('/api/reservations/') ? 401 : 200,
    headers: { get: () => 'application/json' }, json: async () => ({ok: true}) };
};
const result = await watch({ base: 'https://synthetic.invalid', expectedSha: sha, minutes: 1.5,
  intervalSeconds: 30, failRounds: 5, fetchImpl, sleep: async () => {}, log: () => {} });
console.log(JSON.stringify(result));
process.exit(result.exitCode);
"""


class WatchRecoveryResearch(unittest.TestCase):
    def watch(self, case):
        result = subprocess.run(["node", "--input-type=module", "-e", WATCH_SCRIPT, case],
                                cwd=ROOT, text=True, capture_output=True, check=False)
        return result.returncode, json.loads(result.stdout)

    def setUp(self):
        self.http = fixtures.FakeHTTP()
        self.api = fixtures.FakeVercel(self.http)
        self.record = {"baseline": fixtures.BASE, "previous": fixtures.OLD, "commit": fixtures.SHA}
        self.clock = fixtures.FakeClock()

    def recovery(self, candidate):
        return r.recover(self.api, self.http, self.record, candidate,
                         clock=self.clock, sleep=self.clock.sleep, seconds=10)

    def test_terminal_unknown_fails_watch_and_current_candidate_is_recovered(self):
        code, observation = self.watch("unknown")
        self.assertEqual((code, observation["verdict"]), (11, "identity_unknown"))
        # Model the code-only job's current `release != success` condition;
        # this is not a GitHub Actions runtime simulation.
        self.api.current = fixtures.NEW
        self.http.commit = fixtures.SHA
        self.assertEqual(self.recovery(fixtures.NEW), "rolled-back")
        self.assertEqual(self.api.rollbacks, [fixtures.BASE])

    def test_terminal_unknown_never_overwrites_unrelated_alias_or_guesses_candidate(self):
        code, observation = self.watch("unknown")
        self.assertEqual((code, observation["verdict"]), (11, "identity_unknown"))
        self.api.current = "dpl_other"
        for candidate in (fixtures.NEW, None):
            with self.assertRaises(r.Unknown):
                self.recovery(candidate)
            self.assertEqual(self.api.rollbacks, [])

    def test_healthy_and_superseded_have_distinct_outcomes(self):
        code, observation = self.watch("healthy")
        self.assertEqual((code, observation["verdict"]), (0, "healthy"))
        code, observation = self.watch("superseded")
        self.assertEqual((code, observation["verdict"]), (11, "superseded"))

    @unittest.expectedFailure
    def test_alias_cannot_change_between_observation_and_rollback(self):
        # Known gap: the current platform flow is not atomic. This expected
        # failure documents a counterexample, not a production-safe guarantee.
        self.api.current = fixtures.NEW
        original = self.api.deployment
        def competing_writer(ident):
            result = original(ident)
            self.api.current = "dpl_other"
            return result
        self.api.deployment = competing_writer
        self.recovery(fixtures.NEW)
        self.assertEqual(self.api.rollbacks, [])


if __name__ == "__main__":
    unittest.main()
