#!/usr/bin/env python3
"""Synthetic provider tests: no Vercel, DB, credentials, or network access."""
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("priority_release", Path(__file__).with_name("priority-release.py"))
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)
BASE = "a" * 40
NEW = "b" * 40


class Fake:
    def __init__(self):
        self.current = "dpl_base"
        self.calls = []
        self.fail_live = False
        self.fail_rollback = False
        self.promotion_timeout = False
        self.stage_version_wrong = False
        self.baseline_candidate = True
        self.other_writer = False

    def alias(self):
        return self.current

    def deployment(self, identity):
        if identity == "dpl_base":
            return {"id": "dpl_base", "host": "base.vercel.app", "meta": {"githubCommitSha": BASE}}
        raise release.ReleaseError("bad fake ID")

    def rollback_candidate(self, identity):
        return self.baseline_candidate and identity == "dpl_base"

    def stage(self, sha):
        self.calls.append("stage")
        return {"id": "dpl_new", "host": "stage.vercel.app", "meta": {}}

    def version(self, host):
        if host == "stage.vercel.app":
            return {"commit": BASE if self.stage_version_wrong else NEW, "deployment_id": "dpl_new"}
        if self.current == "dpl_new":
            return {"commit": NEW, "deployment_id": "dpl_new"}
        return {"commit": BASE}

    def smoke(self, host):
        self.calls.append("smoke:" + host)
        if self.fail_live and host == release.HOST and self.current == "dpl_new":
            raise release.ReleaseError("synthetic live failure")

    def promote(self, host):
        self.calls.append("promote:" + host)
        self.current = "dpl_new"
        if self.other_writer:
            self.current = "dpl_external"
        if self.promotion_timeout:
            raise release.ReleaseError("synthetic timeout")

    def rollback(self, host):
        self.calls.append("rollback:" + host)
        if self.fail_rollback:
            raise release.ReleaseError("synthetic rollback failure")
        self.current = "dpl_base"


class ReleaseFlowTests(unittest.TestCase):
    def run_flow(self, fake):
        return release.release(fake, BASE, NEW, watch_rounds=2, wait=lambda _: None)

    def test_success_stages_before_promoting_and_watches(self):
        fake = Fake()
        self.assertEqual(self.run_flow(fake), "promoted_and_observed_healthy")
        self.assertLess(fake.calls.index("smoke:stage.vercel.app"), fake.calls.index("promote:stage.vercel.app"))
        self.assertGreaterEqual(fake.calls.count("smoke:" + release.HOST), 4)

    def test_no_rollback_candidate_blocks_before_staging(self):
        fake = Fake()
        fake.baseline_candidate = False
        with self.assertRaises(release.ReleaseError):
            self.run_flow(fake)
        self.assertNotIn("stage", fake.calls)

    def test_wrong_stage_identity_never_promotes(self):
        fake = Fake()
        fake.stage_version_wrong = True
        with self.assertRaises(release.ReleaseError):
            self.run_flow(fake)
        self.assertFalse(any(call.startswith("promote:") for call in fake.calls))

    def test_failed_live_smoke_rolls_back_exact_baseline(self):
        fake = Fake()
        fake.fail_live = True
        with self.assertRaisesRegex(release.ReleaseError, "baseline observed healthy"):
            self.run_flow(fake)
        self.assertIn("rollback:base.vercel.app", fake.calls)
        self.assertEqual(fake.current, "dpl_base")

    def test_unknown_promotion_outcome_is_observed_and_rolled_back_if_candidate_live(self):
        fake = Fake()
        fake.promotion_timeout = True
        with self.assertRaisesRegex(release.ReleaseError, "baseline observed healthy"):
            self.run_flow(fake)
        self.assertEqual(fake.calls.count("promote:stage.vercel.app"), 1)
        self.assertEqual(fake.calls.count("rollback:base.vercel.app"), 1)

    def test_changed_external_alias_is_not_blindly_rolled_back(self):
        fake = Fake()
        fake.other_writer = True
        with self.assertRaisesRegex(release.ReleaseError, "rollback unverified"):
            self.run_flow(fake)
        self.assertFalse(any(call.startswith("rollback:") for call in fake.calls))

    def test_rollback_failure_reports_incident(self):
        fake = Fake()
        fake.fail_live = True
        fake.fail_rollback = True
        with self.assertRaisesRegex(release.ReleaseError, "rollback unverified"):
            self.run_flow(fake)

    def test_no_real_environment_token_needed_for_fake(self):
        self.assertNotIn("VERCEL_TOKEN", Fake().__dict__)


class AdapterTests(unittest.TestCase):
    def test_stage_command_requests_production_without_aliasing(self):
        provider = release.Vercel("synthetic-token", "/synthetic/vercel")
        calls = []
        provider.cli_run = lambda *args, **kwargs: calls.append(args) or "https://stage.vercel.app"
        provider.deployment = lambda host: {"id": "dpl_new", "host": host, "meta": {}}
        self.assertEqual(provider.stage(NEW)["host"], "stage.vercel.app")
        self.assertIn("--prod", calls[0])
        self.assertIn("--skip-domain", calls[0])
        self.assertNotIn("synthetic-token", calls[0])

    def test_rejects_unexpected_staging_host(self):
        provider = release.Vercel("synthetic-token", "/synthetic/vercel")
        provider.cli_run = lambda *args, **kwargs: "https://stage.vercel.app.attacker.invalid"
        with self.assertRaises(release.ReleaseError):
            provider.stage(NEW)

    def test_health_requires_exact_200_and_never_accepts_redirect(self):
        provider = release.Vercel("synthetic-token", "/synthetic/vercel")
        provider.cli_run = lambda *args, **kwargs: "synthetic page\n302"
        with self.assertRaises(release.ReleaseError):
            provider.request("stage.vercel.app", "/book")
        provider.cli_run = lambda *args, **kwargs: "synthetic page\n200"
        self.assertEqual(provider.request("stage.vercel.app", "/book"), "synthetic page")

    def test_rollback_candidacy_fails_closed_on_invalid_response(self):
        provider = release.Vercel("synthetic-token", "/synthetic/vercel")
        provider.api = lambda *args, **kwargs: {"deployments": None}
        with self.assertRaises(release.ReleaseError):
            provider.rollback_candidate("dpl_base")

    def test_rollback_candidacy_requires_matching_id_and_true(self):
        provider = release.Vercel("synthetic-token", "/synthetic/vercel")
        provider.api = lambda *args, **kwargs: {"deployments": [{"uid": "dpl_base", "isRollbackCandidate": False}]}
        self.assertFalse(provider.rollback_candidate("dpl_base"))
        provider.api = lambda *args, **kwargs: {"deployments": [{"uid": "dpl_base", "isRollbackCandidate": True}]}
        self.assertTrue(provider.rollback_candidate("dpl_base"))

    def test_deployment_requires_expected_project_and_production_ready(self):
        provider = release.Vercel("synthetic-token", "/synthetic/vercel")
        good = {"id": "dpl_new", "projectId": release.PROJECT, "target": "production", "readyState": "READY", "url": "stage.vercel.app"}
        provider.api = lambda *args, **kwargs: good
        self.assertEqual(provider.deployment("dpl_new")["id"], "dpl_new")
        for field, value in (("projectId", "wrong"), ("target", "preview"), ("readyState", "BUILDING")):
            with self.subTest(field=field):
                provider.api = lambda *args, field=field, value=value, **kwargs: {**good, field: value}
                with self.assertRaises(release.ReleaseError):
                    provider.deployment("dpl_new")


class WorkflowSafetyTests(unittest.TestCase):
    def test_one_use_job_is_disabled_before_checkout_and_has_no_migration_runner(self):
        workflow = Path(".github/workflows/production-deploy-migrate.yml").read_text(encoding="utf-8")
        job = workflow.split("  code_only_release:\n", 1)[1]
        self.assertLess(job.index("Stop until release hold"), job.index("actions/checkout"))
        self.assertIn("exit 1", job.split("actions/checkout", 1)[0])
        self.assertNotIn("run-production-migration-phase", job)
        self.assertNotIn("resolve-db-url", job)
        self.assertIn("group: production-deploy-main", workflow)


class TreeGuardTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="sunrise-release-tree-")
        self.old_cwd = os.getcwd()
        os.chdir(self.directory.name)
        self.git("init", "-q")
        self.git("config", "user.email", "synthetic@example.invalid")
        self.git("config", "user.name", "Synthetic")
        Path("file.txt").write_text("old", encoding="utf-8")
        self.git("add", "file.txt")
        self.git("commit", "-qm", "base")
        self.base = self.git("rev-parse", "HEAD")
        Path("file.txt").write_text("reviewed", encoding="utf-8")
        self.git("add", "file.txt")
        self.git("commit", "-qm", "reviewed")
        self.head = self.git("rev-parse", "HEAD")
        self.manifest = {"baseline_commit": self.base, "files": {"file.txt": hashlib.sha256(b"reviewed").hexdigest()}}

    def tearDown(self):
        os.chdir(self.old_cwd)
        self.directory.cleanup()

    @staticmethod
    def git(*args):
        return subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL).decode().strip()

    def test_exact_reviewed_tree_is_accepted(self):
        self.assertEqual(release.verify_tree(self.manifest, self.head), self.base)

    def test_modified_file_is_not_accepted(self):
        Path("file.txt").write_text("not reviewed", encoding="utf-8")
        with self.assertRaises(release.ReleaseError):
            release.verify_tree(self.manifest, self.head)

    def test_extra_changed_path_is_rejected(self):
        Path("extra.txt").write_text("extra", encoding="utf-8")
        self.git("add", "extra.txt")
        self.git("commit", "-qm", "extra")
        with self.assertRaises(release.ReleaseError):
            release.verify_tree(self.manifest, self.git("rev-parse", "HEAD"))

    def test_wrong_reviewed_digest_is_rejected(self):
        self.manifest["files"]["file.txt"] = "0" * 64
        with self.assertRaises(release.ReleaseError):
            release.verify_tree(self.manifest, self.head)


if __name__ == "__main__":
    unittest.main()
