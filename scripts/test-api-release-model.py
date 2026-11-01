#!/usr/bin/env python3
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("api_release_model", pathlib.Path(__file__).with_name("api-release-model.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SHA = "a" * 40
REF = f"sunrise-release-probe/{SHA}-123"


class Fake:
    def __init__(self):
        self.events = []
        self.health = True
        self.preview_ok = True
        self.preview_unknown = False
        self.production_unknown = False
        self.rollback_ok = True
        self.incident_broken = False
        self.baseline_broken = False
        self.external_change = False
        self.base = "dpl_base"
        self.production_result = "dpl_new"
    def baseline(self):
        if self.baseline_broken: raise TimeoutError()
        return self.base
    def preview(self, body):
        self.events.append(("preview", body))
        if self.preview_unknown: raise TimeoutError()
        return "preview"
    def preview_matches(self, preview, sha): return self.preview_ok
    def production(self, body):
        self.events.append(("production", body))
        if self.production_unknown: raise TimeoutError()
        self.base = "dpl_new"
        return self.production_result
    def verify_live(self, candidate, sha):
        if self.external_change: self.base = "dpl_external"
        return self.health
    def incident(self, reason, baseline):
        self.events.append(("incident", reason))
        if self.incident_broken: raise OSError()
    def rollback(self, path): self.events.append(("rollback", path)); self.base = "dpl_base"
    def verify_rollback(self, baseline): return self.rollback_ok


class Tests(unittest.TestCase):
    def test_requests_never_use_files_meta_or_preview_production_target(self):
        preview, production = m.create_body(SHA, REF), m.create_body(SHA, "main", True)
        self.assertNotIn("target", preview)
        self.assertEqual(production["target"], "production")
        self.assertEqual(preview["gitSource"]["sha"], SHA)
        self.assertEqual(production["gitSource"]["sha"], SHA)
        for body in (preview, production):
            self.assertNotIn("files", body)
            self.assertNotIn("meta", body)
    def test_mismatched_sha_or_ref_rejected(self):
        for sha, ref, production in [("b" * 40, REF, False), (SHA, "main", False), (SHA, REF, True)]:
            with self.assertRaises(ValueError): m.create_body(sha, ref, production)
    def test_preview_failure_blocks_production(self):
        p = Fake(); p.preview_ok = False
        self.assertEqual(m.release_model(p, SHA, REF), "unknown")
        self.assertFalse(any(event[0] == "production" for event in p.events))
    def test_preview_timeout_is_unknown_and_blocks_production(self):
        p = Fake(); p.preview_unknown = True
        self.assertEqual(m.release_model(p, SHA, REF), "unknown")
        self.assertEqual(p.events[-1], ("incident", "preview-outcome-unknown"))
        self.assertFalse(any(event[0] == "production" for event in p.events))
    def test_failed_live_verification_immediately_rolls_back(self):
        p = Fake(); p.health = False
        self.assertEqual(m.release_model(p, SHA, REF), "rolled-back")
        self.assertEqual(p.events[-2][0], "incident")
        self.assertEqual(p.events[-1], ("rollback", m.rollback_path("dpl_base")))
    def test_incident_failure_cannot_prevent_rollback(self):
        p = Fake(); p.health = False; p.incident_broken = True
        self.assertEqual(m.release_model(p, SHA, REF), "incident-unwritten")
        self.assertEqual(p.events[-1], ("rollback", m.rollback_path("dpl_base")))
    def test_missing_initial_baseline_records_incident_without_creating(self):
        p = Fake(); p.baseline_broken = True
        self.assertEqual(m.release_model(p, SHA, REF), "unknown")
        self.assertEqual(p.events, [("incident", "baseline-unavailable")])
    def test_missing_baseline_and_incident_is_not_reported_safe(self):
        p = Fake(); p.baseline_broken = True; p.incident_broken = True
        self.assertEqual(m.release_model(p, SHA, REF), "incident-unwritten")
    def test_unconfirmed_rollback_stays_unknown(self):
        p = Fake(); p.health = False; p.rollback_ok = False
        self.assertEqual(m.release_model(p, SHA, REF), "unknown")
        self.assertEqual(p.events[-1], ("incident", "rollback-unconfirmed"))
    def test_third_party_alias_is_not_overwritten(self):
        p = Fake(); p.health = False; p.external_change = True
        self.assertEqual(m.release_model(p, SHA, REF), "unknown")
        self.assertEqual(p.base, "dpl_external")
        self.assertFalse(any(event[0] == "rollback" for event in p.events))
        self.assertEqual(p.events[-1], ("incident", "live-alias-not-candidate"))
    def test_unknown_create_does_not_report_safety_or_blind_retry(self):
        p = Fake(); p.production_unknown = True
        self.assertEqual(m.release_model(p, SHA, REF), "unknown")
        self.assertEqual(sum(x[0] == "production" for x in p.events), 1)
        self.assertEqual(p.events[-1], ("incident", "production-outcome-unknown"))
    def test_invalid_production_identity_creates_incident(self):
        for bad in (None, {}, "not-a-deployment"):
            with self.subTest(bad=bad):
                p = Fake(); p.production_result = bad
                self.assertEqual(m.release_model(p, SHA, REF), "unknown")
                self.assertEqual(p.events[-1], ("incident", "production-identity-unknown"))


if __name__ == "__main__": unittest.main()
