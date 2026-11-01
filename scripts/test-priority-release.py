#!/usr/bin/env python3
"""Synthetic provider tests: no Vercel, DB, credentials, or network access."""
import hashlib
import base64
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("priority_release", Path(__file__).with_name("priority-release.py"))
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)
CLI_BLOB_HELPER = str(Path(__file__).with_name("verified-release-cli-blobs.sh").resolve())
LOG_SANITIZER = str(Path(__file__).with_name("sanitize-sandbox-log.py").resolve())
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
        self.stage_source_wrong = False
        self.stage_timeout = False
        self.late_promote = False
        self.late_checks = 0
        self.rollback_timeout = False

    def alias(self):
        if self.late_promote and "promote:stage.vercel.app" in self.calls:
            self.late_checks += 1
            if self.late_checks == 2:
                self.current = "dpl_new"
        return self.current

    def deployment(self, identity):
        if identity == "dpl_base":
            return {"id": "dpl_base", "host": "base.vercel.app", "meta": {"githubCommitSha": BASE}}
        raise release.ReleaseError("bad fake ID")

    def rollback_candidate(self, identity):
        return self.baseline_candidate and identity == "dpl_base"

    def stage(self, sha):
        self.calls.append("stage")
        if self.stage_timeout:
            raise release.ReleaseError("synthetic staging outcome unknown")
        return {"id": "dpl_new", "host": "stage.vercel.app", "meta": {}}

    def verify_selected_source(self, identity, files):
        self.calls.append("verify-source:" + identity)
        if self.stage_source_wrong:
            raise release.ReleaseError("synthetic source mismatch")

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
        if not self.late_promote:
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
        if self.rollback_timeout:
            raise release.ReleaseError("synthetic rollback outcome unknown")


class ReleaseFlowTests(unittest.TestCase):
    def run_flow(self, fake):
        def record(base, candidate): fake.calls.append("incident:" + base + ":" + candidate)
        return release.release(fake, BASE, NEW, {"src/example.ts": "0" * 64}, record_incident=record,
                               watch_rounds=2, recovery_rounds=3, wait=lambda _: None)

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

    def test_wrong_stage_source_never_promotes(self):
        fake = Fake()
        fake.stage_source_wrong = True
        with self.assertRaises(release.ReleaseError):
            self.run_flow(fake)
        self.assertFalse(any(call.startswith("promote:") for call in fake.calls))
        self.assertIn("incident:dpl_base:dpl_new", fake.calls)

    def test_staging_timeout_records_unknown_incident_and_never_promotes(self):
        fake = Fake()
        fake.stage_timeout = True
        with self.assertRaisesRegex(release.ReleaseError, "outcome remains unknown"):
            self.run_flow(fake)
        self.assertIn("incident:dpl_base:unknown", fake.calls)
        self.assertFalse(any(call.startswith("promote:") or call.startswith("rollback:") for call in fake.calls))

    def test_failed_live_smoke_rolls_back_exact_baseline(self):
        fake = Fake()
        fake.fail_live = True
        with self.assertRaisesRegex(release.ReleaseError, "baseline rollback observed healthy"):
            self.run_flow(fake)
        self.assertIn("rollback:base.vercel.app", fake.calls)
        self.assertEqual(fake.current, "dpl_base")

    def test_unknown_promotion_outcome_is_observed_and_rolled_back_if_candidate_live(self):
        fake = Fake()
        fake.promotion_timeout = True
        with self.assertRaisesRegex(release.ReleaseError, "outcome remains unknown"):
            self.run_flow(fake)
        self.assertEqual(fake.calls.count("promote:stage.vercel.app"), 1)
        self.assertEqual(fake.calls.count("rollback:base.vercel.app"), 1)
        self.assertLess(fake.calls.index("incident:dpl_base:dpl_new"), fake.calls.index("rollback:base.vercel.app"))

    def test_late_promotion_is_observed_and_not_blindly_retried(self):
        fake = Fake()
        fake.late_promote = True
        fake.promotion_timeout = True
        with self.assertRaisesRegex(release.ReleaseError, "outcome remains unknown"):
            self.run_flow(fake)
        self.assertEqual(fake.calls.count("promote:stage.vercel.app"), 1)
        self.assertEqual(fake.calls.count("rollback:base.vercel.app"), 1)

    def test_rollback_timeout_is_observed_without_blind_retry(self):
        fake = Fake()
        fake.fail_live = True
        fake.rollback_timeout = True
        with self.assertRaisesRegex(release.ReleaseError, "outcome remains unknown"):
            self.run_flow(fake)
        self.assertEqual(fake.calls.count("rollback:base.vercel.app"), 1)

    def test_changed_external_alias_is_not_blindly_rolled_back(self):
        fake = Fake()
        fake.other_writer = True
        with self.assertRaisesRegex(release.ReleaseError, "outcome remains unknown"):
            self.run_flow(fake)
        self.assertFalse(any(call.startswith("rollback:") for call in fake.calls))

    def test_rollback_failure_reports_incident(self):
        fake = Fake()
        fake.fail_live = True
        fake.fail_rollback = True
        with self.assertRaisesRegex(release.ReleaseError, "outcome remains unknown"):
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
        class Response:
            def __init__(self, status): self.status = status
            def __enter__(self): return self
            def __exit__(self, *_args): pass
            def read(self, _limit): return b"synthetic page"
        class Opener:
            def __init__(self, status): self.status = status
            def open(self, request, timeout):
                self.request = request
                self.timeout = timeout
                return Response(self.status)
        with patch.object(release.urllib.request, "build_opener", return_value=Opener(302)):
            with self.assertRaises(release.ReleaseError):
                provider.request("stage.vercel.app", "/book")
        opener = Opener(200)
        with patch.object(release.urllib.request, "build_opener", return_value=opener):
            self.assertEqual(provider.request("stage.vercel.app", "/book"), "synthetic page")
        self.assertIsNone(opener.request.get_header("Authorization"))

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

    def test_selected_source_bytes_are_verified_without_environment_files(self):
        provider = release.Vercel("synthetic-token", "/synthetic/vercel")
        uid = "a" * 40
        source = b"synthetic source"
        tree = [{"name": "src", "type": "directory", "children": [
            {"name": "example.ts", "type": "file", "uid": uid},
            {"name": ".env.local", "type": "file", "uid": "b" * 40},
        ]}]
        called = []
        def api(path, query=None):
            called.append(path)
            return tree if path.endswith("/files") else {"data": base64.b64encode(source).decode()}
        provider.api = api
        provider.verify_selected_source("dpl_new", {"src/example.ts": hashlib.sha256(source).hexdigest()})
        self.assertEqual(len(called), 2)
        self.assertTrue(called[-1].endswith(uid))
        self.assertFalse(any("b" * 40 in path for path in called))

    def test_different_staged_source_is_rejected(self):
        provider = release.Vercel("synthetic-token", "/synthetic/vercel")
        tree = [{"name": "src", "type": "directory", "children": [{"name": "example.ts", "type": "file", "uid": "a" * 40}]}]
        provider.api = lambda path, query=None: tree if path.endswith("/files") else {"data": base64.b64encode(b"wrong").decode()}
        with self.assertRaises(release.ReleaseError):
            provider.verify_selected_source("dpl_new", {"src/example.ts": hashlib.sha256(b"reviewed").hexdigest()})


class WorkflowSafetyTests(unittest.TestCase):
    def test_one_use_job_is_disabled_before_checkout_and_has_no_migration_runner(self):
        workflow = Path(".github/workflows/production-deploy-migrate.yml").read_text(encoding="utf-8")
        job = workflow.split("  code_only_release:\n", 1)[1]
        self.assertLess(job.index("Stop until release hold"), job.index("actions/checkout"))
        self.assertIn("exit 1", job.split("actions/checkout", 1)[0])
        self.assertNotIn("run-production-migration-phase", job)
        self.assertNotIn("resolve-db-url", job)
        self.assertIn("group: production-deploy-main", workflow)
        self.assertIn("Upload release incident evidence", job)
        self.assertIn("Record release incident", job)

    def test_cli_contract_uses_rootless_restricted_sandboxes_without_checkout_credentials(self):
        workflow = Path(".github/workflows/ci.yml").read_text(encoding="utf-8")
        job = workflow.split("  release-cli-contract:\n", 1)[1].split("  e2e-smoke:\n", 1)[0]
        self.assertIn("persist-credentials: false", job)
        self.assertIn("bwrap --unshare-user --unshare-pid", job)
        self.assertIn("--unshare-net", job)
        self.assertIn("--clearenv", job)
        self.assertNotIn("sudo ", job)
        self.assertNotIn("--bind / /", job)
        self.assertNotIn("VERCEL_TOKEN", job)
        self.assertIn('grep -Fxq -- "65.9.0" /tmp/version.txt', job)

    def test_cli_version_match_rejects_near_matches(self):
        with tempfile.TemporaryDirectory(prefix="sunrise-cli-version-") as directory:
            path = Path(directory) / "version.txt"
            for text, expected in (("65.9.0\n", 0), ("165x9x0\n", 1), ("65x9x0\n", 1), ("165.9.0\n", 1)):
                path.write_text(text, encoding="utf-8")
                result = subprocess.run(["grep", "-Fxq", "--", "65.9.0", str(path)], check=False)
                self.assertEqual(result.returncode, expected)

    def test_incident_record_is_private_and_rejects_overwrite(self):
        with tempfile.TemporaryDirectory(prefix="sunrise-incident-") as directory:
            path = Path(directory) / "incident.json"
            with patch.dict(os.environ, {"RUNNER_TEMP": directory, "RELEASE_INCIDENT_PATH": str(path)}):
                release.write_incident("dpl_base", "dpl_new")
                data = path.read_text(encoding="utf-8")
                self.assertIn("release_incident", data)
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                with self.assertRaises(FileExistsError):
                    release.write_incident("dpl_base", "dpl_new")

    def test_unknown_stage_identity_can_be_recorded(self):
        with tempfile.TemporaryDirectory(prefix="sunrise-incident-") as directory:
            path = Path(directory) / "incident.json"
            with patch.dict(os.environ, {"RUNNER_TEMP": directory, "RELEASE_INCIDENT_PATH": str(path)}):
                release.write_incident("dpl_base", "unknown")
                self.assertIn('"candidate_id": "unknown"', path.read_text(encoding="utf-8"))

    def test_sandbox_log_cannot_emit_legacy_or_v2_workflow_commands(self):
        with tempfile.TemporaryDirectory(prefix="sunrise-log-") as directory:
            path = Path(directory) / "output.txt"
            path.write_text("\n".join(["filler"] * 35 + [
                "ordinary text ##[add-mask]synthetic", "##[error]synthetic",
                "::error::synthetic", "prefix ::warning::synthetic", "\x1b[31mred\rsecond", "#" * 2000,
            ]), encoding="utf-8")
            result = subprocess.run(["python3", "-B", LOG_SANITIZER, str(path)], text=True,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
            self.assertNotIn("##[", result.stdout)
            self.assertNotIn("::", result.stdout)
            self.assertNotIn("\x1b", result.stdout)
            self.assertEqual(len(result.stdout.splitlines()), 30)
            self.assertTrue(all(line.startswith(" | ") for line in result.stdout.splitlines()))
            self.assertLess(max(map(len, result.stdout.splitlines())), 5000)


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
        self.tree = self.git("rev-parse", "HEAD^{tree}")
        self.manifest = {"baseline_commit": self.base, "reviewed_tree": release.REVIEWED_FEATURE_TREE,
                         "reviewed_merge_commit": release.REVIEWED_FEATURE_MERGE,
                         "files": {"file.txt": hashlib.sha256(b"reviewed").hexdigest()}}

    def tearDown(self):
        os.chdir(self.old_cwd)
        self.directory.cleanup()

    @staticmethod
    def git(*args):
        return subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL).decode().strip()

    def test_exact_reviewed_tree_is_accepted(self):
        self.assertEqual(release.verify_tree(self.manifest, self.head, self.tree), self.base)

    def test_modified_file_is_not_accepted(self):
        Path("file.txt").write_text("not reviewed", encoding="utf-8")
        with self.assertRaises(release.ReleaseError):
            release.verify_tree(self.manifest, self.head, self.tree)

    def test_extra_changed_path_is_rejected(self):
        Path("extra.txt").write_text("extra", encoding="utf-8")
        self.git("add", "extra.txt")
        self.git("commit", "-qm", "extra")
        with self.assertRaises(release.ReleaseError):
            release.verify_tree(self.manifest, self.git("rev-parse", "HEAD"), self.tree)

    def test_wrong_reviewed_digest_is_rejected(self):
        self.manifest["files"]["file.txt"] = "0" * 64
        with self.assertRaises(release.ReleaseError):
            release.verify_tree(self.manifest, self.head, self.tree)

    def test_changed_infrastructure_does_not_match_reviewed_tree(self):
        Path("scripts").mkdir()
        Path("scripts/priority-release.py").write_text("altered implementation", encoding="utf-8")
        self.git("add", "scripts/priority-release.py")
        self.git("commit", "-qm", "altered infra")
        with self.assertRaises(release.ReleaseError):
            release.verify_tree(self.manifest, self.git("rev-parse", "HEAD"), self.tree)

    def test_reviewed_feature_metadata_is_required(self):
        self.manifest["reviewed_tree"] = "0" * 40
        with self.assertRaises(release.ReleaseError):
            release.verify_tree(self.manifest, self.head, self.tree)


class CliManifestBlobTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="sunrise-cli-blob-")
        self.root = Path(self.directory.name)
        self.git("init", "-q")
        self.git("config", "user.email", "synthetic@example.invalid")
        self.git("config", "user.name", "Synthetic")
        (self.root / "scripts/release-cli").mkdir(parents=True)
        self.output = self.root / "output"
        self.output.mkdir()

    def tearDown(self):
        self.directory.cleanup()

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, stderr=subprocess.DEVNULL).decode().strip()

    def invoke(self):
        return subprocess.run(["bash", CLI_BLOB_HELPER, str(self.output)], cwd=self.root,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)

    def commit(self):
        self.git("add", "scripts")
        self.git("commit", "-qm", "synthetic")

    def test_copies_only_regular_bounded_committed_blobs(self):
        (self.root / "scripts/release-cli/package.json").write_text("{}", encoding="utf-8")
        (self.root / "scripts/release-cli/package-lock.json").write_text("{}", encoding="utf-8")
        self.commit()
        self.assertEqual(self.invoke().returncode, 0)
        self.assertEqual((self.output / "package.json").read_text(encoding="utf-8"), "{}")

    def test_rejects_file_symlink_without_following_it(self):
        (self.root / "scripts/release-cli/package.json").write_text("{}", encoding="utf-8")
        (self.root / "scripts/release-cli/package-lock.json").symlink_to("/nonexistent-synthetic-secret")
        self.commit()
        self.assertNotEqual(self.invoke().returncode, 0)
        self.assertFalse((self.output / "package-lock.json").exists())

    def test_rejects_parent_directory_symlink(self):
        (self.root / "scripts/release-cli").rmdir()
        (self.root / "scripts/release-cli").symlink_to("/nonexistent-synthetic-secret")
        self.commit()
        self.assertNotEqual(self.invoke().returncode, 0)

    def test_rejects_oversized_blob(self):
        (self.root / "scripts/release-cli/package.json").write_text("x" * 2000001, encoding="utf-8")
        (self.root / "scripts/release-cli/package-lock.json").write_text("{}", encoding="utf-8")
        self.commit()
        self.assertNotEqual(self.invoke().returncode, 0)

if __name__ == "__main__":
    unittest.main()
