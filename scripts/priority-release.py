#!/usr/bin/env python3
"""One-use staged code-only release. Never executes SQL or migration runners.

The committed workflow has an unconditional stop ahead of this program until
release prerequisites are reviewed. No production command has been run here.
"""
import hashlib
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

TEAM = "team_o4vau0vkVyakLaNFPmhXkL5M"
PROJECT = "prj_5swHVn2nqzrZ50VYx1zoEXZAvKiP"
HOST = "sunrise-cafe-six.vercel.app"
ID = re.compile(r"dpl_[A-Za-z0-9]+\Z")
SHA = re.compile(r"[a-f0-9]{40}\Z")
HOSTNAME = re.compile(r"[a-z0-9-]+\.vercel\.app\Z")
REVIEWED_FEATURE_TREE = "aeae32f5fd467e7004de03ebcaf443b494d0a5a8"
REVIEWED_FEATURE_MERGE = "b03bbee6161d1fc82cb989951f3169fb3e30f806"
INFRA = {
    ".github/workflows/production-deploy-migrate.yml",
    ".github/workflows/ci.yml",
    "scripts/priority-release.py", "scripts/test-priority-release.py",
    "scripts/priority-release-manifest.json", "scripts/release-cli/package.json",
    "scripts/verified-release-cli-blobs.sh",
    "scripts/sanitize-sandbox-log.py",
    "scripts/release-cli/package-lock.json", "docs/plans/2026-11-priority-code-only-release.md",
    "docs/RUNBOOK.md", "docs/plans/2026-11-deploy-before-postdeploy.md",
    "docs/plans/2026-11-migration-backup-fail-closed.md",
    "docs/plans/2026-11-release-safety-integration.md", "scripts/post-deploy-watch.mjs",
    "scripts/pre-migration-backup.sh", "scripts/resolve-db-url.sh",
    "scripts/run-production-migration-phase.mjs", "scripts/verify-backup-upload.sh",
    "src/lib/deploy-version-gate.test.ts", "src/lib/post-deploy-watch.test.ts",
    "src/lib/pre-migration-backup-gate.test.ts", "src/lib/pre-migration-backup.test.ts",
}


class ReleaseError(Exception):
    pass


def git_bytes(*args):
    result = subprocess.run(["git", *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise ReleaseError("local source verification failed")
    return result.stdout


def verify_tree(manifest, expected_sha, reviewed_tree):
    if not SHA.fullmatch(expected_sha) or git_bytes("rev-parse", "HEAD").decode().strip() != expected_sha:
        raise ReleaseError("checkout does not match requested commit")
    if not SHA.fullmatch(reviewed_tree) or git_bytes("rev-parse", expected_sha + "^{tree}").decode().strip() != reviewed_tree:
        raise ReleaseError("checkout tree differs from the independently reviewed tree")
    if git_bytes("status", "--porcelain", "--untracked-files=all").strip():
        raise ReleaseError("checkout contains uncommitted content")
    base = manifest.get("baseline_commit", "")
    if not SHA.fullmatch(base):
        raise ReleaseError("invalid baseline")
    if (manifest.get("reviewed_tree") != REVIEWED_FEATURE_TREE
            or manifest.get("reviewed_merge_commit") != REVIEWED_FEATURE_MERGE):
        raise ReleaseError("invalid reviewed feature identity")
    ancestry = subprocess.run(["git", "merge-base", "--is-ancestor", base, expected_sha],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    if ancestry.returncode:
        raise ReleaseError("baseline is not an ancestor")
    files = manifest.get("files")
    if not isinstance(files, dict) or not files:
        raise ReleaseError("missing reviewed content manifest")
    changed = set(filter(None, git_bytes("diff", "--name-only", "-z", base, expected_sha).decode().split("\0")))
    if not changed <= set(files) | INFRA:
        raise ReleaseError("candidate contains unreviewed paths")
    if not set(files) <= changed:
        raise ReleaseError("reviewed changes are missing")
    for name, digest in files.items():
        if (not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_.\-/]+", name)
                or name.startswith("/") or ".." in Path(name).parts
                or Path(name).name.startswith(".env")
                or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest)):
            raise ReleaseError("invalid reviewed manifest entry")
        contents = git_bytes("show", f"{expected_sha}:{name}")
        if hashlib.sha256(contents).hexdigest() != digest:
            raise ReleaseError("reviewed source content changed")
    return base


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ReleaseError("platform returned an unexpected redirect")


class Vercel:
    def __init__(self, token, cli):
        if not token or not cli:
            raise ReleaseError("platform access is not configured")
        self.token, self.cli = token, cli

    def api(self, path, query=None):
        if not path.startswith("/") or ".." in path:
            raise ReleaseError("invalid platform API path")
        params = {"teamId": TEAM, **(query or {})}
        req = urllib.request.Request(
            "https://api.vercel.com" + path + "?" + urllib.parse.urlencode(params),
            headers={"Authorization": "Bearer " + self.token, "Accept": "application/json"},
        )
        try:
            with urllib.request.build_opener(NoRedirect).open(req, timeout=20) as response:
                raw = response.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                raise ReleaseError("platform response too large")
            return json.loads(raw)
        except (OSError, ValueError, urllib.error.URLError) as exc:
            raise ReleaseError("platform query failed") from exc

    def cli_run(self, *args, timeout=900):
        try:
            result = subprocess.run([self.cli, "--scope", TEAM, *args], stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ReleaseError("platform command outcome unknown") from exc
        if result.returncode:
            raise ReleaseError("platform command failed or outcome is unknown")
        return result.stdout.decode("utf-8", "strict").strip()

    def alias(self):
        value = self.api("/v4/aliases/" + HOST)
        deployment = value.get("deploymentId") or (value.get("deployment") or {}).get("id")
        if value.get("projectId") != PROJECT or not isinstance(deployment, str) or not ID.fullmatch(deployment):
            raise ReleaseError("production alias identity unavailable")
        return deployment

    def deployment(self, identity):
        if not (ID.fullmatch(identity) or HOSTNAME.fullmatch(identity)):
            raise ReleaseError("invalid deployment identity")
        value = self.api("/v13/deployments/" + identity)
        project = value.get("projectId") or (value.get("project") or {}).get("id")
        dep_id, host = value.get("id") or value.get("uid"), value.get("url")
        if (project != PROJECT or value.get("target") != "production"
                or (value.get("readyState") or value.get("state")) != "READY"
                or not isinstance(dep_id, str) or not ID.fullmatch(dep_id)
                or not isinstance(host, str) or not HOSTNAME.fullmatch(host)):
            raise ReleaseError("deployment target or readiness is invalid")
        return {"id": dep_id, "host": host, "meta": value.get("meta") or {}}

    def rollback_candidate(self, deployment_id):
        until = None
        seen = set()
        for _ in range(10):
            query = {"projectId": PROJECT, "target": "production", "rollbackCandidate": "true", "limit": "100"}
            if until is not None:
                query["until"] = str(until)
            value = self.api("/v7/deployments", query)
            deployments = value.get("deployments")
            if not isinstance(deployments, list):
                raise ReleaseError("rollback candidate list unavailable")
            if any(isinstance(item, dict) and item.get("uid", item.get("id")) == deployment_id
                   and item.get("isRollbackCandidate") is True for item in deployments):
                return True
            until = (value.get("pagination") or {}).get("next")
            if until is None or until in seen or not isinstance(until, int):
                break
            seen.add(until)
        return False

    def stage(self, sha):
        output = self.cli_run("deploy", "--prod", "--skip-domain", "--yes",
                              "--build-env", "SUNRISE_RELEASE_SHA=" + sha,
                              "--env", "SUNRISE_RELEASE_SHA=" + sha)
        parsed = urllib.parse.urlparse(output)
        if (parsed.scheme != "https" or not parsed.hostname or not HOSTNAME.fullmatch(parsed.hostname)
                or parsed.username or parsed.password or parsed.port or parsed.path not in ("", "/")
                or parsed.query or parsed.fragment):
            raise ReleaseError("unexpected staging URL")
        return self.deployment(parsed.hostname)

    def verify_selected_source(self, deployment_id, files):
        """Verify selected runtime source bytes, not the entire build provenance."""
        if not ID.fullmatch(deployment_id):
            raise ReleaseError("invalid stage identity")
        tree = self.api("/v6/deployments/" + deployment_id + "/files")
        if not isinstance(tree, list):
            raise ReleaseError("staged source tree unavailable")
        found = {}
        count = 0
        def walk(entries, prefix="", depth=0):
            nonlocal count
            if depth > 40 or not isinstance(entries, list):
                raise ReleaseError("invalid staged source tree")
            for entry in entries:
                count += 1
                if count > 30000 or not isinstance(entry, dict):
                    raise ReleaseError("invalid staged source tree")
                name, kind = entry.get("name"), entry.get("type")
                if not isinstance(name, str) or not name or "/" in name or name in (".", ".."):
                    raise ReleaseError("invalid staged source tree")
                path = prefix + name
                if kind == "directory":
                    walk(entry.get("children"), path + "/", depth + 1)
                elif kind == "file":
                    if path in found:
                        raise ReleaseError("duplicate staged source path")
                    found[path] = entry.get("uid")
                elif kind not in ("symlink", "lambda", "middleware"):
                    raise ReleaseError("invalid staged source tree")
        walk(tree)
        selected = {name: digest for name, digest in files.items()
                    if name.startswith("src/") and not re.search(r"\.test\.[^.]+$", name)}
        if not selected:
            raise ReleaseError("no reviewed runtime source selected")
        for name, digest in selected.items():
            # The CLI source listing can wrap the project in a root `src`.
            paths = [path for path in (name, "src/" + name) if path in found]
            if len(paths) != 1:
                raise ReleaseError("reviewed runtime source missing or ambiguous")
            file_id = found[paths[0]]
            if not isinstance(file_id, str) or not re.fullmatch(r"[a-fA-F0-9]{40,64}", file_id):
                raise ReleaseError("invalid staged source identity")
            data = self.api("/v8/deployments/" + deployment_id + "/files/" + file_id)
            if not isinstance(data, dict) or not isinstance(data.get("data"), str):
                raise ReleaseError("staged source bytes unavailable")
            try:
                source = base64.b64decode(data["data"], validate=True)
            except ValueError as exc:
                raise ReleaseError("invalid staged source bytes") from exc
            if hashlib.sha256(source).hexdigest() != digest:
                raise ReleaseError("staged runtime source differs from reviewed content")

    def request(self, host, path):
        if not HOSTNAME.fullmatch(host) or path not in ("/api/version", "/", "/book", "/menu"):
            raise ReleaseError("invalid health target")
        # A raw read-only GET intentionally fails closed on deployment protection.
        # `vercel curl` may create a new protection-bypass credential, so it is
        # not used. No API token is sent to the deployment host.
        request = urllib.request.Request("https://" + host + path, headers={"Cache-Control": "no-store"})
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
                if response.status != 200:
                    raise ReleaseError("health endpoint did not return HTTP 200")
                raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise ReleaseError("health response too large")
            return raw.decode("utf-8", "strict")
        except (OSError, UnicodeError, urllib.error.URLError) as exc:
            raise ReleaseError("health endpoint unavailable or protected") from exc

    def version(self, host):
        try:
            value = json.loads(self.request(host, "/api/version"))
        except ValueError as exc:
            raise ReleaseError("runtime identity unavailable") from exc
        if not isinstance(value, dict):
            raise ReleaseError("runtime identity unavailable")
        return value

    def smoke(self, host):
        for path in ("/", "/book", "/menu"):
            self.request(host, path)

    def promote(self, host):
        self.cli_run("promote", "https://" + host, "--yes", timeout=300)

    def rollback(self, host):
        self.cli_run("rollback", "https://" + host, "--yes", timeout=300)


def same_version(provider, host, sha, deployment_id=None):
    version = provider.version(host)
    if version.get("commit") != sha:
        raise ReleaseError("runtime SHA mismatch")
    if deployment_id is not None and version.get("deployment_id") != deployment_id:
        raise ReleaseError("runtime deployment ID mismatch")


def release(provider, base, candidate_sha, source_files, *, record_incident=None,
            watch_rounds=30, recovery_rounds=20, wait=time.sleep):
    if record_incident is None:
        raise ReleaseError("durable incident recorder is unavailable")
    baseline_id = provider.alias()
    baseline = provider.deployment(baseline_id)
    if baseline["id"] != baseline_id or baseline["meta"].get("githubCommitSha") != base:
        raise ReleaseError("baseline metadata mismatch")
    if not provider.rollback_candidate(baseline_id):
        raise ReleaseError("baseline rollback candidacy is unavailable")
    same_version(provider, HOST, base)
    provider.smoke(HOST)
    stage = None
    stage_id = "unknown"
    promotion_returned = False
    try:
        # The production-target staging call itself may have unknown cron or
        # timeout effects; everything after it starts is covered by incident
        # recording and bounded observation, even before promotion.
        stage = provider.stage(candidate_sha)
        stage_id = stage["id"]
        if stage_id == baseline_id:
            stage_id = "unknown"
            raise ReleaseError("stage reused the baseline deployment")
        provider.verify_selected_source(stage_id, source_files)
        same_version(provider, stage["host"], candidate_sha, stage_id)
        provider.smoke(stage["host"])
        if provider.alias() != baseline_id:
            raise ReleaseError("production alias changed before promotion")
        # Repository concurrency serializes cooperating workflows; an external
        # writer can still race between this observation and the promote call.
        provider.promote(stage["host"])
        promotion_returned = True
        for attempt in range(21):
            observed = provider.alias()
            if observed == stage["id"]:
                break
            if observed != baseline_id:
                raise ReleaseError("production alias changed during promotion")
            if attempt == 20:
                raise ReleaseError("production alias did not converge")
            wait(3)
        same_version(provider, HOST, candidate_sha, stage["id"])
        provider.smoke(HOST)
        if provider.alias() != stage["id"]:
            raise ReleaseError("production alias changed during health check")
        # Observe the exact deployment for 15 minutes (30 rounds, 30 seconds).
        # A cancelled runner or workflow can interrupt this watch and requires
        # independent monitoring; this function cannot guarantee that response.
        for _ in range(watch_rounds):
            wait(30)
            if provider.alias() != stage["id"]:
                raise ReleaseError("production alias changed during watch")
            same_version(provider, HOST, candidate_sha, stage["id"])
            provider.smoke(HOST)
        return "promoted_and_observed_healthy"
    except Exception as failure:
        # Record the incident *before* observing or attempting rollback. The
        # workflow separately persists it after this step; a killed runner can
        # still lose it and needs an independently staffed response.
        incident_written = True
        try:
            record_incident(baseline_id, stage_id)
        except Exception:
            incident_written = False
        rollback_attempted = False
        rollback_unknown = False
        baseline_last = False
        # The provider may finish an already timed-out promotion later. Observe
        # boundedly, roll back at most once after positively seeing our ID, and
        # do not treat a currently healthy baseline as proof of final outcome.
        for attempt in range(recovery_rounds + 1):
            baseline_verified = False
            try:
                current = provider.alias()
                if stage_id != "unknown" and current == stage_id and not rollback_attempted:
                    rollback_attempted = True
                    try:
                        provider.rollback(baseline["host"])
                    except Exception:
                        rollback_unknown = True
                    current = provider.alias()
                if current not in (baseline_id, stage_id):
                    raise ReleaseError("another deployment became current")
                baseline_last = current == baseline_id
                if baseline_last and promotion_returned and not rollback_unknown:
                    same_version(provider, HOST, base)
                    provider.smoke(HOST)
                    baseline_verified = True
            except ReleaseError:
                baseline_last = False
            except Exception:
                baseline_last = False
            if baseline_verified:
                if incident_written:
                    raise ReleaseError("release failed; baseline rollback observed healthy; incident recorded") from failure
                raise ReleaseError("release failed; baseline observed healthy but incident recording failed") from failure
            if attempt < recovery_rounds:
                wait(3)
        # Finite observation cannot prove a late operation will never complete.
        state = "baseline last observed" if baseline_last else "alias unverified"
        incident = "incident recorded" if incident_written else "incident recording failed"
        raise ReleaseError("release outcome remains unknown; " + state + "; " + incident + "; immediate response required") from failure


def write_incident(baseline_id, candidate_id):
    location, runner_temp = os.environ.get("RELEASE_INCIDENT_PATH", ""), os.environ.get("RUNNER_TEMP", "")
    if (not location or not runner_temp or not ID.fullmatch(baseline_id)
            or (candidate_id != "unknown" and not ID.fullmatch(candidate_id))
            or Path(location).parent.resolve() != Path(runner_temp).resolve()):
        raise ReleaseError("incident path is invalid")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(location, flags, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump({"status": "release_incident", "baseline_id": baseline_id,
                   "candidate_id": candidate_id, "action": "immediate operator investigation required"}, stream)
        stream.flush()
        os.fsync(stream.fileno())


def main():
    try:
        manifest = json.loads(Path("scripts/priority-release-manifest.json").read_text(encoding="utf-8"))
        sha = os.environ.get("GITHUB_SHA", "")
        base = verify_tree(manifest, sha, os.environ.get("REVIEWED_TREE_SHA", ""))
        if os.environ.get("GITHUB_REF") != "refs/heads/main":
            raise ReleaseError("release target is not main")
        if os.environ.get("VERCEL_ORG_ID") != TEAM or os.environ.get("VERCEL_PROJECT_ID") != PROJECT:
            raise ReleaseError("CLI project or team binding is invalid")
        # A preexisting local link can override intended CLI context. GitHub's
        # clean checkout must use the explicit reviewed IDs above instead.
        if Path(".vercel/project.json").exists() or Path(".vercel/repo.json").exists():
            raise ReleaseError("unexpected local Vercel project link")
        provider = Vercel(os.environ.get("VERCEL_TOKEN", ""), os.environ.get("VERCEL_CLI", ""))
        print(release(provider, base, sha, manifest["files"], record_incident=write_incident))
        return 0
    except ReleaseError as exc:
        print("::error::" + str(exc), file=sys.stderr)
        return 1
    except (OSError, ValueError):
        print("::error::Release blocked or failed; check the incident and documented recovery procedure", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
