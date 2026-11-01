#!/usr/bin/env python3
"""Synthetic, offline checks for the production identity evidence classifier."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("identity_evaluate", ROOT / "scripts/production-identity-evaluate.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
SHA = "a" * 40
OTHER = "b" * 40
NOW = datetime(2026, 11, 1, tzinfo=timezone.utc)


def observations():
    return [SHA, json.dumps({"commit": SHA}), json.dumps({"ok": True, "stripe_enabled": False}),
            "200", "[]", json.dumps([{"status": "completed", "conclusion": "success", "headSha": SHA}]),
            json.dumps([{"createdAt": "2026-11-01T00:00:00Z"}]), "[]", "https://example.invalid", "example/repo"]


class EvaluateTests(unittest.TestCase):
    def classify(self, args):
        return MODULE.evaluate(args, NOW)

    def test_nominal_observations_are_unknown_not_green(self):
        result = self.classify(observations())
        self.assertEqual(result["overall"], "UNKNOWN")
        self.assertEqual(result["drift_red"], [])
        self.assertIn("database_target_and_migrations_unverified", result["evidence_unknown"])
        self.assertIn("deployment_writer_fence_unverified", result["evidence_unknown"])

    def test_distinct_full_sha_is_red(self):
        args = observations()
        args[1] = json.dumps({"commit": OTHER})
        self.assertIn("remote_main_ne_api_version_sha", self.classify(args)["drift_red"])
        self.assertEqual(self.classify(args)["overall"], "RED")

    def test_short_or_malformed_sha_is_unknown_never_accepted(self):
        for bad in (SHA[:12], "g" * 40, "", "A" * 40):
            with self.subTest(bad=bad):
                args = observations()
                args[1] = json.dumps({"commit": bad})
                result = self.classify(args)
                self.assertIn("api_version_sha_unknown_or_invalid", result["evidence_unknown"])
                self.assertNotEqual(result["overall"], "GREEN")

    def test_incomplete_or_wrong_sha_verification_is_unknown(self):
        for verify in ("[]", "invalid", json.dumps([{"status": "in_progress", "headSha": SHA}]),
                       json.dumps([{"status": "completed", "conclusion": "success", "headSha": OTHER}])):
            with self.subTest(verify=verify):
                args = observations()
                args[5] = verify
                self.assertTrue(any(value.startswith("production_verification_") for value in self.classify(args)["evidence_unknown"]))

    def test_current_sha_failed_verification_is_red(self):
        args = observations()
        args[5] = json.dumps([{"status": "completed", "conclusion": "failure", "headSha": SHA}])
        self.assertIn("production_verification_not_success", self.classify(args)["drift_red"])

    def test_bad_health_and_stale_bi_are_red(self):
        args = observations()
        args[2] = json.dumps({"ok": False})
        args[6] = json.dumps([{"createdAt": "2026-10-29T00:00:00Z"}])
        result = self.classify(args)
        self.assertEqual(result["overall"], "RED")
        self.assertIn("booking_health_not_ok", result["drift_red"])
        self.assertIn("outcome_pipeline_stale", result["drift_red"])

    def test_missing_bad_or_inconsistent_health_is_unknown(self):
        for code, body in (("000", ""), ("200", "not-json"), ("200", "{}"),
                           ("503", json.dumps({"ok": True})), ("404", "{}")):
            with self.subTest(code=code, body=body):
                args = observations()
                args[2], args[3] = body, code
                result = self.classify(args)
                self.assertIn("booking_health_unknown", result["evidence_unknown"])
                self.assertNotIn("booking_health_not_ok", result["drift_red"])

    def test_explicit_503_unhealthy_is_red(self):
        args = observations()
        args[2], args[3] = json.dumps({"ok": False}), "503"
        self.assertIn("booking_health_not_ok", self.classify(args)["drift_red"])

    def test_malformed_payloads_and_dates_do_not_crash_or_infer_payment(self):
        args = observations()
        args[1:4] = ["[]", "null", "200"]
        args[4:8] = ["{}", "{}", json.dumps([{"createdAt": "invalid"}]), "{}"]
        result = self.classify(args)
        self.assertNotEqual(result["overall"], "GREEN")
        self.assertEqual(result["payment_integration_status"]["mode"], "unknown")
        self.assertEqual(result["outcome_pipeline"]["freshness"], "unknown")


class ShellIntegrationTests(unittest.TestCase):
    def test_existing_collector_returns_unknown_nonzero_with_stubbed_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            bindir = Path(directory)
            for command in ("bash", "python3", "awk", "dirname"):
                target = subprocess.run(["/usr/bin/which", command], capture_output=True, text=True, check=True).stdout.strip()
                (bindir / command).symlink_to(target)
            scripts = {
                "git": f"#!/bin/sh\nif [ \"${{SYNTHETIC_GIT_FAILURE:-0}}\" = 1 ]; then exit 1; fi\nprintf '%s\\trefs/heads/main\\n' {'a' * 40}\n",
                "curl": f'''#!/bin/sh
case " $* " in
  *" --write-out "*) printf '{{"ok":true,"stripe_enabled":false}}\\n200' ;;
  *"/api/version"*) printf '{{"commit":"{'a' * 40}"}}' ;;
  *) printf '{{"ok":true,"stripe_enabled":false}}' ;;
esac
''',
                "gh": "#!/bin/sh\nprintf '[]'\n",
            }
            for name, content in scripts.items():
                path = bindir / name
                path.write_text(content)
                path.chmod(0o755)
            env = {"PATH": str(bindir), "SUNRISE_REPO": "example/repo", "SUNRISE_PROD_URL": "https://example.invalid"}
            completed = subprocess.run([str(bindir / "bash"), str(ROOT / "scripts/production-identity.sh")],
                                       env=env, cwd=ROOT, capture_output=True, text=True, timeout=10)
            self.assertEqual(completed.returncode, 2, completed.stderr)
            self.assertEqual(json.loads(completed.stdout)["overall"], "UNKNOWN")
            env["SYNTHETIC_GIT_FAILURE"] = "1"
            failed_git = subprocess.run([str(bindir / "bash"), str(ROOT / "scripts/production-identity.sh")],
                                        env=env, cwd=ROOT, capture_output=True, text=True, timeout=10)
            self.assertEqual(failed_git.returncode, 2, failed_git.stderr)
            self.assertIn("remote_main_sha_unknown_or_invalid", json.loads(failed_git.stdout)["evidence_unknown"])


if __name__ == "__main__":
    unittest.main()
