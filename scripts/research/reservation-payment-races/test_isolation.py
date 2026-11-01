"""Unit checks for the synthetic harness's Docker isolation contract."""
import os
import stat
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import run as fixture


class IsolationTest(unittest.TestCase):
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
