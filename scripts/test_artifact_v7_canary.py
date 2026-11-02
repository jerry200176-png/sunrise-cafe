import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/artifact-v7-canary.yml"


def parsed_workflow():
    js = "const fs=require('fs'),y=require('js-yaml');process.stdout.write(JSON.stringify(y.load(fs.readFileSync(process.argv[1],'utf8'))))"
    return json.loads(subprocess.check_output(["node", "-e", js, str(WORKFLOW)], cwd=ROOT))


class SyntheticArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.workflow = parsed_workflow()
        self.upload = self.workflow["jobs"]["upload"]
        self.verify = self.workflow["jobs"]["verify"]
        self.create_script = self.upload["steps"][0]["run"]
        self.verify_script = self.verify["steps"][-1]["run"]
        self.env = {"PATH": os.defpath, "RUNNER_TEMP": str(self.root)}
        for index, kind in enumerate(("BASELINE", "CANDIDATE", "BACKUP"), 1):
            self.env[f"{kind}_ID"] = str(index)
            self.env[f"{kind}_DIGEST"] = "a" * 64

    def tearDown(self):
        self.temp.cleanup()

    def run_script(self, source, env=None):
        return subprocess.run(["bash", "-c", source], env=env or self.env, capture_output=True, text=True)

    def create_downloads(self):
        self.assertEqual(self.run_script(self.create_script).returncode, 0)
        shutil.copytree(self.root / "artifact-v7-fixtures", self.root / "artifact-v7-downloaded")

    def test_workflow_is_pr_only_without_repository_token_or_production_paths(self):
        workflow = self.workflow
        self.assertEqual(set(workflow["on"]), {"pull_request"})
        self.assertEqual(workflow["permissions"], {})
        self.assertEqual(set(workflow["jobs"]), {"upload", "verify"})
        self.assertEqual(self.verify["needs"], "upload")
        for job in (self.upload, self.verify):
            self.assertEqual(job["runs-on"], "ubuntu-latest")
            self.assertEqual(job["timeout-minutes"], 10)
            self.assertNotIn("permissions", job)
        source = json.dumps(workflow)
        for forbidden in ("secrets.", "github.token", "GH_TOKEN", "actions/checkout", "VERCEL_TOKEN", "SUPABASE", "production-code-only", "production-deploy-migrate"):
            self.assertNotIn(forbidden, source)
        uploads = [step for step in self.upload["steps"] if step.get("uses", "").startswith("actions/upload-artifact@")]
        self.assertEqual(len(uploads), 3)
        for step in uploads:
            self.assertEqual(step["uses"], "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9")
            self.assertEqual(step["with"]["retention-days"], 7)
            self.assertEqual(step["with"]["if-no-files-found"], "error")
            self.assertNotIn("archive", step["with"])
        downloads = [step for step in self.verify["steps"] if step.get("uses", "").startswith("actions/download-artifact@")]
        self.assertEqual(len(downloads), 3)
        for step in downloads:
            self.assertEqual(step["uses"], "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093")
            self.assertNotIn("github-token", step["with"])
        for kind, upload, download in zip(("baseline", "candidate", "backup"), uploads, downloads):
            expected = f"artifact-v7-canary-{kind}-${{{{ github.run_id }}}}-${{{{ github.run_attempt }}}}"
            self.assertEqual(upload["with"]["name"], expected)
            self.assertEqual(download["with"]["name"], expected)
        expected_outputs = {}
        expected_env = {}
        for kind in ("baseline", "candidate", "backup"):
            for suffix in ("id", "digest"):
                output_name = f"{kind}-{suffix}"
                expected_outputs[output_name] = f"${{{{ steps.{kind}.outputs.artifact-{suffix} }}}}"
                expected_env[f"{kind.upper()}_{suffix.upper()}"] = f"${{{{ needs.upload.outputs.{output_name} }}}}"
        self.assertEqual(self.upload["outputs"], expected_outputs)
        self.assertEqual(self.verify["steps"][-1]["env"], expected_env)

    def test_inline_scripts_accept_unchanged_synthetic_downloads(self):
        self.create_downloads()
        self.assertEqual(self.run_script(self.verify_script).returncode, 0)

    def test_inline_verifier_rejects_bad_upload_outputs(self):
        self.create_downloads()
        for key, value in (("BASELINE_ID", ""), ("BASELINE_ID", "2"), ("BACKUP_DIGEST", "invalid")):
            env = {**self.env, key: value}
            with self.subTest(key=key, value=value):
                self.assertNotEqual(self.run_script(self.verify_script, env).returncode, 0)

    def test_inline_verifier_rejects_changed_or_extra_files(self):
        self.create_downloads()
        root = self.root / "artifact-v7-downloaded"
        baseline = root / "baseline/sunrise-code-only-baseline.json"
        original = baseline.read_bytes()
        baseline.write_bytes(b"changed")
        self.assertNotEqual(self.run_script(self.verify_script).returncode, 0)
        baseline.write_bytes(original)
        (root / "candidate/extra.txt").write_bytes(b"unexpected")
        self.assertNotEqual(self.run_script(self.verify_script).returncode, 0)

    def test_inline_verifier_rejects_symlinks(self):
        self.create_downloads()
        path = self.root / "artifact-v7-downloaded/candidate/sunrise-code-only-candidate.json"
        content = path.read_bytes()
        path.unlink()
        target = self.root / "external"
        target.write_bytes(content)
        path.symlink_to(target)
        self.assertNotEqual(self.run_script(self.verify_script).returncode, 0)


if __name__ == "__main__":
    unittest.main()
