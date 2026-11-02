#!/usr/bin/env python3
"""Offline synthetic checks; never opens an actual backup or identity."""
import importlib.util
import json
import os
import subprocess
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parent

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

secure = load('secure_inputs', 'secure-open-inputs.py')
wrapper = load('wsl_wrapper', 'wsl-restore.py')
extract = load('legacy_extract', 'extract-legacy-artifact.py')

class SafePaths(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='synthetic-backup-check-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'synthetic-input'
        self.source.write_bytes(b'synthetic original')

    def test_secure_fd_survives_path_replacement(self):
        for opener in (secure.secure_open, wrapper.open_regular_nofollow):
            with self.subTest(opener=opener.__name__):
                self.source.write_bytes(b'synthetic original')
                fd = opener(str(self.source))
                try:
                    moved = self.root / 'moved'
                    self.source.rename(moved)
                    self.source.symlink_to(moved)
                    self.assertEqual(os.read(fd, 100), b'synthetic original')
                    self.source.unlink()
                    moved.rename(self.source)
                finally:
                    os.close(fd)

    def test_rejects_symlinks_hardlinks_and_nonfiles(self):
        link = self.root / 'link'
        link.symlink_to(self.source)
        parent = self.root / 'parent-link'
        parent.symlink_to(self.root, target_is_directory=True)
        hard = self.root / 'hard'
        os.link(self.source, hard)
        for opener in (secure.secure_open, wrapper.open_regular_nofollow):
            for path in (link, parent / 'synthetic-input', hard, self.root):
                with self.subTest(opener=opener.__name__, kind=path.name):
                    with self.assertRaises((SystemExit, wrapper.Abort)):
                        opener(str(path))

    def test_non_executable_shell_entrypoint_fails_before_calling_helpers(self):
        fakebin = self.root / 'bin'
        fakebin.mkdir()
        marker = self.root / 'invoked'
        for name in ('docker', 'age'):
            command = fakebin / name
            command.write_text('#!/bin/sh\nprintf called > "' + str(marker) + '"\nexit 1\n')
            command.chmod(0o700)
        result = subprocess.run(
            ['/bin/bash', str(ROOT / 'restore-legacy-local.sh')],
            input=('/missing/synthetic.zip\nsha256:' + '0' * 64 + '\n/missing/synthetic-identity\n'),
            text=True, capture_output=True, timeout=5,
            env={'PATH': str(fakebin) + ':/usr/bin:/bin'}, check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Local input paths are unavailable', result.stderr)
        self.assertFalse(marker.exists())

    def test_rejects_untrusted_input_path_components(self):
        for opener in (secure.secure_open, wrapper.open_regular_nofollow):
            for path in ('relative', '/tmp/.ssh/identity', '/tmp/.aws/identity', '/tmp/.env-config/file', '/tmp/a/../b'):
                with self.subTest(opener=opener.__name__, path=path):
                    with self.assertRaises((SystemExit, wrapper.Abort)):
                        opener(path)

class SyntheticArchives(unittest.TestCase):
    def test_rejects_path_traversal_and_extra_entries(self):
        with tempfile.TemporaryDirectory(prefix='synthetic-backup-zip-') as tmp:
            root = Path(tmp)
            manifest = {'label': 'predeploy', 'created_at_utc': '20260101T000000Z', 'bytes': 1000,
                        'sha256': 'a' * 64, 'tables_with_data': 1, 'encrypted': True,
                        'schema': 'public', 'format': 'pg_dump custom'}
            for index, names in enumerate((['../manifest.json', 'sunrise-cafe_predeploy_20260101T000000Z.dump.age'],
                                           ['manifest.json', 'sunrise-cafe_predeploy_20260101T000000Z.dump.age', 'extra'])):
                archive = root / f'{index}.zip'
                output = root / f'out{index}'
                output.mkdir()
                with zipfile.ZipFile(archive, 'w') as z:
                    for name in names:
                        z.writestr(name, json.dumps(manifest) if name.endswith('manifest.json') else b'synthetic')
                with patch.object(sys, 'argv', ['extract', str(archive), str(output)]):
                    with self.assertRaises(SystemExit): extract.main()
                self.assertEqual(list(output.iterdir()), [])
                self.assertFalse((root / 'manifest.json').exists())

    def test_wrapper_pins_match_each_checked_in_helper(self):
        import hashlib
        for name, digest in wrapper.HELPERS.items():
            with self.subTest(name=name):
                self.assertEqual(hashlib.sha256((ROOT / name).read_bytes()).hexdigest(), digest)

if __name__ == '__main__':
    unittest.main()
