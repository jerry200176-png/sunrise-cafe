#!/usr/bin/env python3
"""Classify existing production observations; this evaluator does not make network requests."""
import json
import re
import sys
from datetime import datetime, timezone

SHA = re.compile(r"^[0-9a-f]{40}$")


def parse(raw, expected):
    try:
        value = json.loads(raw) if raw else None
    except (TypeError, ValueError):
        return None
    return value if isinstance(value, expected) else None


def first_object(raw):
    values = parse(raw, list)
    return values[0] if values and isinstance(values[0], dict) else None


def evaluate(args, now=None):
    remote_main, version_raw, health_raw, health_code, deploy_json, verify_json, bi_json, line_json, prod_url, repo = args
    now = now or datetime.now(timezone.utc)
    version = parse(version_raw, dict) or {}
    health = parse(health_raw, dict) or {}
    deploy = first_object(deploy_json)
    verify = first_object(verify_json)
    bi = first_object(bi_json)
    line = first_object(line_json)
    prod_commit = version.get("commit")
    main_valid = isinstance(remote_main, str) and SHA.fullmatch(remote_main) is not None
    prod_valid = isinstance(prod_commit, str) and SHA.fullmatch(prod_commit) is not None
    stripe = health.get("stripe_enabled")
    red = []
    unknown = [
        "deployment_provenance_unverified",
        "database_target_and_migrations_unverified",
        "deployment_writer_fence_unverified",
        "regional_convergence_unverified",
        "rollback_readiness_unverified",
    ]
    if not main_valid:
        unknown.append("remote_main_sha_unknown_or_invalid")
    if not prod_valid:
        unknown.append("api_version_sha_unknown_or_invalid")
    if main_valid and prod_valid and remote_main != prod_commit:
        red.append("remote_main_ne_api_version_sha")
    if health_code in ("200", "503") and health.get("ok") is False:
        red.append("booking_health_not_ok")
    elif health_code != "200" or health.get("ok") is not True:
        unknown.append("booking_health_unknown")
    # Preserve the existing red signal for the latest failed or cancelled
    # run even when it does not correspond to the current main commit.
    if verify and verify.get("conclusion") in ("failure", "cancelled"):
        red.append("production_verification_not_success")
    if not verify or verify.get("status") != "completed":
        unknown.append("production_verification_missing_or_incomplete")
    elif verify.get("headSha") != remote_main or not main_valid:
        unknown.append("production_verification_not_for_current_main")
    elif verify.get("conclusion") != "success" and "production_verification_not_success" not in red:
        red.append("production_verification_not_success")

    outcome_freshness = "unknown"
    bi_created = (bi or {}).get("createdAt")
    if isinstance(bi_created, str):
        try:
            ts = datetime.fromisoformat(bi_created.replace("Z", "+00:00"))
            if ts.tzinfo is not None:
                age_h = (now - ts).total_seconds() / 3600
                if 0 <= age_h <= 36:
                    outcome_freshness = "fresh"
                elif age_h > 36:
                    outcome_freshness = "stale"
                    red.append("outcome_pipeline_stale")
        except (OverflowError, ValueError):
            pass
    if outcome_freshness == "unknown":
        unknown.append("outcome_pipeline_freshness_unknown")

    mode = "line_deposit_screenshot" if stripe is False else "stripe_or_mixed" if stripe is True else "unknown"
    return {
        "project": "sunrise-cafe",
        "generated_at": now.isoformat(),
        "prod_url": prod_url,
        "repo": repo,
        "remote_main_full_sha": remote_main,
        "vercel_deployment_sha": (deploy or {}).get("sha"),
        "api_version_sha": prod_commit,
        "last_production_deployment": deploy,
        "last_verify_production_run": verify,
        "migration_version": None,
        "migration_version_status": "unknown_without_verified_target_and_ledger",
        "booking_health": health,
        "booking_health_http": health_code,
        "payment_integration_status": {"stripe_enabled": stripe, "mode": mode},
        "line_reminder": {
            "backup_workflow_conclusion": (line or {}).get("conclusion"),
            "backup_workflow_at": (line or {}).get("createdAt"),
            "execution_vs_delivery": "unknown_without_cron_secret",
            "note": "Execution: cron/job_runs; Delivery: LINE API success counts — must not be conflated",
        },
        "outcome_pipeline": {"last_bi_run": bi, "freshness": outcome_freshness},
        "drift_red": red,
        "evidence_unknown": unknown,
        "overall": "RED" if red else "UNKNOWN" if unknown else "GREEN",
    }


def main():
    if len(sys.argv) != 11:
        raise SystemExit("expected ten observation arguments")
    result = evaluate(sys.argv[1:])
    print(json.dumps(result, indent=2, ensure_ascii=False))
    raise SystemExit({"GREEN": 0, "RED": 1, "UNKNOWN": 2}[result["overall"]])


if __name__ == "__main__":
    main()
