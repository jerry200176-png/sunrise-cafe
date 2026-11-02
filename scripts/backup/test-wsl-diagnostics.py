#!/usr/bin/env python3
"""Synthetic-only tests: diagnostics never include untrusted subprocess bytes."""
import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).with_name('wsl-restore.py')
spec = importlib.util.spec_from_file_location('sunrise_wsl_restore', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SafeDiagnosticTests(unittest.TestCase):
    def test_all_fixed_helper_failures_map_to_fixed_stage_hints(self):
        self.assertEqual(len(module.SAFE_FAILURE_STAGES), 18)
        for raw, hint in module.SAFE_FAILURE_STAGES.items():
            with self.subTest(stage=hint):
                result = module.safe_failure_stage(b'\n\n', raw + b'\n')
                self.assertEqual(result, hint)
                self.assertNotIn(raw.decode('ascii'), result)

    def test_empty_unknown_or_nonbyte_streams_do_not_guess(self):
        for stdout, stderr in [(b'', b''), (b'', b'unexpected'), (None, b''), (b'', None),
                               (b'', b'\xff\x00'), (b'', b'x' * 65537), (b'x' * 65537, b'')]:
            with self.subTest(kind=type(stderr).__name__):
                self.assertEqual(module.safe_failure_stage(stdout, stderr), module.UNKNOWN_FAILURE_STAGE)

    def test_sensitive_or_mixed_output_never_leaks_or_spoofs_a_stage(self):
        sentinel = b'FAKE_KEY_FAKE_EMAIL_FAKE_PATH_FAKE_SQL_FAKE_DB_ERROR'
        valid = b'Decryption failed; stopping.'
        cases = [
            (b'', sentinel),
            (sentinel, valid + b'\n'),
            (b'\n', sentinel + b'\n' + valid + b'\n'),
            (b'', valid + b' ' + sentinel + b'\n'),
            (b'', valid + b'\n' + sentinel),
            (b'', b'\x1b[31m' + valid + b'\x1b[0m\n'),
            (b'', valid + b'\r\n'),
        ]
        for stdout, stderr in cases:
            with self.subTest(size=len(stderr)):
                result = module.safe_failure_stage(stdout, stderr)
                self.assertEqual(result, module.UNKNOWN_FAILURE_STAGE)
                self.assertNotIn(sentinel.decode('ascii'), result)
                self.assertNotIn(valid.decode('ascii'), result)

    def test_multiple_fixed_stages_do_not_imply_a_cause(self):
        raw = b'Decryption failed; stopping.\nIsolated restore database unavailable.\n'
        self.assertEqual(module.safe_failure_stage(b'\n', raw), module.UNKNOWN_FAILURE_STAGE)


if __name__ == '__main__':
    unittest.main()
