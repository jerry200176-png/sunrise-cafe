"""Unit checks for the synthetic harness's Docker isolation contract."""
import os
import stat
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import run as fixture


class IsolationTest(unittest.TestCase):
    def test_optimized_python_fails_before_fixture_execution(self):
        script = str(Path(fixture.__file__).resolve())
        for args, optimize in ((['-O'], None), ([], '1'), ([], '2')):
            with self.subTest(args=args, optimize=optimize):
                env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8',
                       'PYTHONDONTWRITEBYTECODE': '1'}
                if optimize is not None:
                    env['PYTHONOPTIMIZE'] = optimize
                result = subprocess.run([sys.executable, *args, script], env=env,
                                        capture_output=True, text=True, timeout=5)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, '')
                self.assertEqual(result.stderr.strip(),
                    'Python optimization is unsupported; run without -O or PYTHONOPTIMIZE')

    def test_non_socket_and_non_root_socket_fail_closed(self):
        with self.assertRaises(RuntimeError):
            fixture.validate_socket_info(SimpleNamespace(st_mode=stat.S_IFREG, st_uid=0))
        with self.assertRaises(RuntimeError):
            fixture.validate_socket_info(SimpleNamespace(st_mode=stat.S_IFSOCK, st_uid=1000))
        fixture.validate_socket_info(SimpleNamespace(st_mode=stat.S_IFSOCK, st_uid=0))

    def test_remote_context_and_config_never_enter_child_environment(self):
        with patch.dict(os.environ, {'DOCKER_HOST':'tcp://127.0.0.1:1',
                                     'DOCKER_CONTEXT':'synthetic-remote',
                                     'DOCKER_CONFIG':'/synthetic-remote-config'}), \
             patch.object(fixture,'DOCKER_BIN','/trusted/docker'), \
             patch.object(fixture,'DOCKER_CONFIG','/isolated/config'):
            self.assertEqual(fixture.docker_command('ps'),
                ['/trusted/docker','--host','unix:///var/run/docker.sock',
                 '--config','/isolated/config','ps'])
            self.assertEqual(set(fixture.SAFE_ENV), {'PATH','LANG'})
            self.assertNotIn('DOCKER_HOST',fixture.SAFE_ENV)
            self.assertNotIn('DOCKER_CONTEXT',fixture.SAFE_ENV)
            self.assertNotIn('DOCKER_CONFIG',fixture.SAFE_ENV)

    def test_missing_explicit_config_fails_closed(self):
        with patch.object(fixture,'DOCKER_CONFIG',None):
            with self.assertRaises(RuntimeError): fixture.docker_command('ps')

    def test_only_immutable_container_id_is_accepted_for_cleanup(self):
        self.assertEqual(fixture.validate_container_id('a'*64),'a'*64)
        for value in ('--volumes', 'a'*12, 'z'*64, ''):
            with self.assertRaises(RuntimeError): fixture.validate_container_id(value)


if __name__=='__main__':
    unittest.main()
