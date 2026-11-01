#!/usr/bin/env python3
"""Offline-only model of the documented Git-source Vercel release sequence.

No transport or credentials are implemented. Never deploy from this module.
"""
import re

SHA = re.compile(r"[a-f0-9]{40}\Z")
ID = re.compile(r"dpl_[A-Za-z0-9]+\Z")
PROJECT = "prj_5swHVn2nqzrZ50VYx1zoEXZAvKiP"


def create_body(sha, ref, production=False):
    if not SHA.fullmatch(sha):
        raise ValueError("invalid source SHA")
    if production:
        if ref != "main":
            raise ValueError("production requires the reviewed main ref")
    elif not re.fullmatch(r"sunrise-release-probe/" + sha + r"-[1-9][0-9]{0,19}", ref):
        raise ValueError("preview ref does not select this commit")
    body = {"name": "sunrise-cafe", "project": PROJECT,
            "gitSource": {"type": "github", "org": "jerry200176-png", "repo": "sunrise-cafe", "ref": ref, "sha": sha}}
    if production:
        body["target"] = "production"
    return body


def rollback_path(deployment_id):
    if not ID.fullmatch(deployment_id):
        raise ValueError("invalid rollback deployment")
    return f"/v1/projects/{PROJECT}/rollback/{deployment_id}"


def try_incident(provider, reason, baseline):
    try:
        provider.incident(reason, baseline)
        return True
    except Exception:
        return False


def recover(provider, reason, baseline):
    incident_ok = try_incident(provider, reason, baseline)
    try:
        provider.rollback(rollback_path(baseline))
        if provider.verify_rollback(baseline):
            return "rolled-back" if incident_ok else "incident-unwritten"
    except Exception:
        pass
    rollback_incident_ok = try_incident(provider, "rollback-unconfirmed", baseline)
    return "unknown" if incident_ok and rollback_incident_ok else "incident-unwritten"


def release_model(provider, sha, ref):
    """Mock orchestration only; unknown results attempt to create an incident.

    Preconditions (identity, CI, authorization, backup, workers and rollback
    access) must be independently established by a future real adapter.
    """
    try:
        baseline = provider.baseline()
        if not isinstance(baseline, str) or not ID.fullmatch(baseline):
            raise ValueError("invalid baseline")
    except Exception:
        return "unknown" if try_incident(provider, "baseline-unavailable", "unknown") else "incident-unwritten"
    try:
        preview = provider.preview(create_body(sha, ref))
    except Exception:
        # A timed-out preview may still build and may have side effects.
        return "unknown" if try_incident(provider, "preview-outcome-unknown", baseline) else "incident-unwritten"
    try:
        preview_ok = provider.preview_matches(preview, sha)
    except Exception:
        preview_ok = False
    if not preview_ok:
        try:
            current = provider.baseline()
        except Exception:
            return "unknown" if try_incident(provider, "preview-identity-unavailable", baseline) else "incident-unwritten"
        if isinstance(preview, str) and ID.fullmatch(preview) and current == preview:
            # A request intended as preview may have changed production traffic.
            return recover(provider, "preview-traffic-changed", baseline)
        if current != baseline:
            return "unknown" if try_incident(provider, "unexpected-alias-change", baseline) else "incident-unwritten"
        # An in-flight deployment may still change traffic after this check.
        return "unknown" if try_incident(provider, "preview-unverified", baseline) else "incident-unwritten"
    try:
        current = provider.baseline()
    except Exception:
        return "unknown" if try_incident(provider, "baseline-unavailable", baseline) else "incident-unwritten"
    if current != baseline:
        return "blocked" if try_incident(provider, "baseline-changed", baseline) else "incident-unwritten"
    try:
        candidate = provider.production(create_body(sha, "main", True))
    except Exception:
        # Unknown create may still complete and change traffic later.
        return "unknown" if try_incident(provider, "production-outcome-unknown", baseline) else "incident-unwritten"
    if not isinstance(candidate, str) or not ID.fullmatch(candidate):
        return "unknown" if try_incident(provider, "production-identity-unknown", baseline) else "incident-unwritten"
    try:
        if provider.verify_live(candidate, sha):
            return "verified"
    except Exception:
        pass
    try:
        current = provider.baseline()
    except Exception:
        return "unknown" if try_incident(provider, "live-alias-unavailable", baseline) else "incident-unwritten"
    if current != candidate:
        # Baseline may be observed while a request is still in flight; a third
        # writer may also have changed the alias. Never overwrite either blindly.
        return "unknown" if try_incident(provider, "live-alias-not-candidate", baseline) else "incident-unwritten"
    return recover(provider, "live-verification-failed", baseline)


if __name__ == "__main__":
    raise SystemExit("Research model only: release is hard-stopped; no production adapter exists")
