#!/usr/bin/env python3
"""Open local user-selected files once, without following path symlinks.

Input consists of two absolute UTF-8 paths separated by NUL on stdin. The
worker inherits only file descriptors and never receives those paths.
Linux only: the worker subsequently uses /proc/self/fd for the age identity.
"""
import os
from pathlib import PurePosixPath
import stat
import sys


def fail():
    raise SystemExit('Local input paths are unavailable, disallowed or contain symlinks.')


def secure_open(raw):
    if not raw or not raw.startswith('/') or '\n' in raw or '\r' in raw:
        fail()
    parts = PurePosixPath(raw).parts[1:]
    if (not parts or any(part in ('.', '..', '.ssh', '.aws') or part.startswith('.env') for part in parts)
            or '..' in raw.split('/')):
        fail()
    current = None
    try:
        current = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        for part in parts[:-1]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
            os.close(current)
            current = next_fd
        result = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=current)
        info = os.fstat(result)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            os.close(result)
            fail()
        return result
    except (OSError, ValueError):
        fail()
    finally:
        if current is not None:
            os.close(current)


def main():
    raw = sys.stdin.buffer.read(32769)
    if len(raw) > 32768:
        fail()
    try:
        paths = raw.decode('utf-8').split('\0')
    except UnicodeError:
        fail()
    if len(paths) != 2 or len(sys.argv) != 2:
        fail()
    zip_fd = secure_open(paths[0])
    try:
        identity_fd = secure_open(paths[1])
        if os.fstat(zip_fd).st_dev == os.fstat(identity_fd).st_dev and os.fstat(zip_fd).st_ino == os.fstat(identity_fd).st_ino:
            fail()
        os.set_inheritable(zip_fd, True)
        os.set_inheritable(identity_fd, True)
        env = dict(os.environ, BACKUP_ZIP_FD=str(zip_fd), BACKUP_IDENTITY_FD=str(identity_fd))
        os.execve('/bin/bash', ['/bin/bash', sys.argv[1]], env)
    finally:
        os.close(zip_fd)


if __name__ == '__main__':
    main()
