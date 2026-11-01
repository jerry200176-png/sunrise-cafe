#!/usr/bin/env python3
"""Inspect and extract only the two supported pre-migration artifact files.

The ZIP SHA-256 must be checked independently before calling this script.
Extracts ciphertext and a small manifest only; it never handles plaintext.
"""
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import zipfile


def fail():
    raise SystemExit('Unsupported or unsafe legacy backup artifact.')


def main():
    if len(sys.argv) != 3:
        fail()
    archive, output = Path(sys.argv[1]), Path(sys.argv[2])
    if not output.is_dir() or any(output.iterdir()):
        fail()
    with zipfile.ZipFile(archive) as zf:
        entries = zf.infolist()
        if len(entries) != 2 or len({item.filename for item in entries}) != 2:
            fail()
        manifest_entries = [item for item in entries if item.filename == 'manifest.json']
        dump_entries = [item for item in entries if re.fullmatch(
            r'sunrise-cafe_(predeploy|postdeploy)_[0-9]{8}T[0-9]{6}Z\.dump\.age', item.filename
        )]
        if len(manifest_entries) != 1 or len(dump_entries) != 1:
            fail()
        manifest_entry, dump_entry = manifest_entries[0], dump_entries[0]
        for item in entries:
            mode = item.external_attr >> 16
            if item.is_dir() or stat.S_IFMT(mode) not in (0, stat.S_IFREG):
                fail()
        if not 0 < manifest_entry.file_size <= 16384 or not 0 < dump_entry.file_size <= 16 * 1024 ** 3:
            fail()
        # Do not inflate an attacker-supplied archive beyond available local space.
        if dump_entry.file_size + 16384 + 64 * 1024 ** 2 > shutil.disk_usage(output).free:
            fail()
        try:
            manifest = json.loads(zf.read(manifest_entry))
        except (ValueError, UnicodeDecodeError):
            fail()
        if (not isinstance(manifest, dict)
                or set(manifest) != {'label', 'created_at_utc', 'bytes', 'sha256', 'tables_with_data', 'encrypted', 'schema', 'format'}
                or type(manifest.get('tables_with_data')) is not int or manifest['tables_with_data'] < 1
                or manifest.get('encrypted') is not True
                or manifest.get('schema') != 'public' or manifest.get('format') != 'pg_dump custom'
                or manifest.get('label') not in ('predeploy', 'postdeploy')
                or not isinstance(manifest.get('created_at_utc'), str)
                or not re.fullmatch(r'[0-9]{8}T[0-9]{6}Z', manifest['created_at_utc'])
                or type(manifest.get('bytes')) is not int or manifest['bytes'] < 1000
                or not isinstance(manifest.get('sha256'), str)
                or not re.fullmatch(r'[a-f0-9]{64}', manifest['sha256'])
                or dump_entry.filename != f"sunrise-cafe_{manifest['label']}_{manifest['created_at_utc']}.dump.age"):
            fail()
        for item in entries:
            target = output / item.filename
            with zf.open(item) as source, target.open('xb') as dest:
                shutil.copyfileobj(source, dest, length=1024 * 1024)
    # Fixed output consumed by the local shell; values are never printed to user logs.
    os.rename(output / dump_entry.filename, output / 'backup.dump.age')


if __name__ == '__main__':
    main()
