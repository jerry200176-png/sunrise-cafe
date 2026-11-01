#!/usr/bin/env python3
"""Interactive, single-use WSL wrapper for reviewed #521 legacy restore helpers.

Takes only public paths, an independently obtained ZIP digest, and a verified
Docker manifest digest in argv. The reviewed source archive may predate this file.
An age identity is entered privately at the controlling terminal, never argv,
environment, shell history or chat. See notes after the script before running.
"""
import getpass
import ctypes
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import warnings
import zipfile

# Four reviewed helper files at #521 commit 9dd2a46. No other ZIP member is run.
HELPERS = {
    'restore-legacy-local.sh': 'f105444b62a8aa03df3d11df71d98a48925898db886c3401a46e7a132d47a402',
    'secure-open-inputs.py': 'e505bc2945cf4051c12aeee2fe61e516aee23f816e4fd568dca645e277280227',
    'restore-legacy-worker.sh': '59f4a2f82e66cd3ddc752f026dd3ea28ed5ebb048170ac3e8626662a94eb12b5',
    'extract-legacy-artifact.py': 'dae25d4b0d92a4e2f9d35102449e209933f79e017b41974ae3ae2b3ccccd4b80',
}

class Abort(Exception):
    pass


def fail(message):
    raise Abort(message)


def on_signal(_signum, _frame):
    raise Abort('操作已中斷；正在清理本機暫存。')


def open_regular_nofollow(path):
    if not os.path.isabs(path) or '\n' in path or '\r' in path:
        fail('輸入檔案路徑無效。')
    parts = Path(path).parts[1:]
    if (not parts or '..' in path.split('/') or any(p in ('.ssh', '.aws') or p.startswith('.env') for p in parts)):
        fail('輸入檔案路徑不允許。')
    parent = None
    try:
        parent = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        for component in parts[:-1]:
            following = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent)
            parent = following
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
            os.close(fd)
            fail('輸入檔案類型或連結數不允許。')
        return fd
    except OSError:
        fail('無法安全開啟輸入檔案。')
    finally:
        if parent is not None:
            os.close(parent)


def tmpfs_shm():
    try:
        # Linux statfs asks the kernel about the currently visible mount; an
        # older covered /dev/shm entry in mountinfo cannot satisfy this check.
        buf = ctypes.create_string_buffer(256)
        call = ctypes.CDLL(None, use_errno=True).statfs
        call.argtypes = [ctypes.c_char_p, ctypes.c_void_p]
        call.restype = ctypes.c_int
        return call(b'/dev/shm', buf) == 0 and ctypes.c_long.from_buffer(buf).value == 0x01021994
    except (OSError, AttributeError, ValueError):
        return False


def copy_verified_helpers(source_fd, output_dir):
    with os.fdopen(source_fd, 'rb', closefd=False) as source, zipfile.ZipFile(source) as archive:
        all_entries = archive.infolist()
        chosen = {}
        roots = set()
        for name, expected_sha in HELPERS.items():
            suffix = f'scripts/backup/{name}'
            candidates = [item for item in all_entries if item.filename == suffix or item.filename.endswith('/' + suffix)]
            if len(candidates) != 1:
                fail('來源封裝缺少已審核的工具或有重複檔案。')
            item = candidates[0]
            root = item.filename[:-len(suffix)]
            if root and not re.fullmatch(r'[A-Za-z0-9._-]+/', root):
                fail('來源封裝結構不安全。')
            roots.add(root)
            mode = item.external_attr >> 16
            if item.is_dir() or stat.S_IFMT(mode) not in (0, stat.S_IFREG) or not 0 < item.file_size <= 262144:
                fail('來源工具格式不安全。')
            contents = archive.read(item)
            if not hmac.compare_digest(hashlib.sha256(contents).hexdigest(), expected_sha):
                fail('來源工具 SHA-256 與已審核版本不同。')
            chosen[name] = contents
        if len(roots) != 1:
            fail('來源工具不屬於同一份封裝。')
    # Write only the four reviewed files; never extract any other ZIP member.
    for name, contents in chosen.items():
        destination = os.path.join(output_dir, name)
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as output:
            output.write(contents)
        if not hmac.compare_digest(hashlib.sha256(Path(destination).read_bytes()).hexdigest(), HELPERS[name]):
            fail('本機工具完整性檢查失敗。')


def sha256_fd(fd):
    digest = hashlib.sha256()
    os.lseek(fd, 0, os.SEEK_SET)
    while True:
        chunk = os.read(fd, 1024 * 1024)
        if not chunk:
            break
        digest.update(chunk)
    return digest.hexdigest()


def command(*args, env):
    try:
        result = subprocess.run(args, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired):
        fail('本機 Docker 或所需工具無法使用。')
    if result.returncode != 0 or len(result.stdout) > 65536:
        fail('本機 Docker 或所需工具檢查未通過。')
    return result.stdout


def terminate_child(process):
    if process is None or process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.communicate(timeout=15)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.communicate()
    except ProcessLookupError:
        pass


def main(argv):
    if len(argv) != 4:
        fail('請提供來源 ZIP、加密備份 ZIP、可信 ZIP SHA-256 及 PostgreSQL 映像 manifest SHA-256。')
    source_path, backup_path, expected_zip_sha256, image_manifest_sha256 = argv
    if not re.fullmatch(r'[a-f0-9]{64}', expected_zip_sha256) or not re.fullmatch(r'[a-f0-9]{64}', image_manifest_sha256):
        fail('ZIP 或映像 SHA-256 格式不正確。')
    expected_image_manifest = f'postgres@sha256:{image_manifest_sha256}'
    if not tmpfs_shm():
        fail('/dev/shm 不是可確認的 tmpfs，未要求私鑰。')
    try:
        sock = os.lstat('/var/run/docker.sock')
    except OSError:
        fail('本機 Docker socket 不可用，未要求私鑰。')
    if not stat.S_ISSOCK(sock.st_mode) or sock.st_uid != 0:
        fail('Docker socket 不是 root 擁有的本機 Unix socket。')
    docker = shutil.which('docker')
    age = shutil.which('age')
    if not docker or not age or not shutil.which('python3') or not shutil.which('sha256sum'):
        fail('缺少本機 Docker、age、Python 或 SHA-256 工具。')
    # Only retain directories needed to find these executables and standard tools.
    safe_path = os.pathsep.join(dict.fromkeys([str(Path(docker).parent), str(Path(age).parent), '/usr/bin', '/bin']))
    env = {'PATH': safe_path, 'LANG': 'C.UTF-8'}
    source_fd = open_regular_nofollow(source_path)
    try:
        backup_fd = open_regular_nofollow(backup_path)
    except BaseException:
        os.close(source_fd)
        raise
    work = None
    process = None
    try:
        source_stat, backup_stat = os.fstat(source_fd), os.fstat(backup_fd)
        if (source_stat.st_dev, source_stat.st_ino) == (backup_stat.st_dev, backup_stat.st_ino):
            fail('來源 ZIP 與備份 ZIP 不可為同一檔案。')
        if shutil.disk_usage('/dev/shm').free < 1024 * 1024:
            fail('/dev/shm 可用空間不足，未要求私鑰。')
        work = tempfile.mkdtemp(prefix='sunrise-operator-', dir='/dev/shm')
        os.chmod(work, 0o700)
        helper_dir = os.path.join(work, 'scripts', 'backup')
        os.makedirs(helper_dir, mode=0o700)
        copy_verified_helpers(source_fd, helper_dir)
        print('正在核對加密備份的 SHA-256，請稍候……', flush=True)
        if not hmac.compare_digest(sha256_fd(backup_fd), expected_zip_sha256):
            fail('加密備份 SHA-256 不符，未要求私鑰。')
        config = os.path.join(work, 'docker-config')
        os.mkdir(config, 0o700)
        docker_cmd = (docker, '--config', config, '--host', 'unix:///var/run/docker.sock')
        command(*docker_cmd, 'version', '--format', '{{.Server.Version}}', env=env)
        raw = command(*docker_cmd, 'image', 'inspect', 'postgres:17-alpine', '--format', '{{json .RepoDigests}}|{{.Id}}', env=env)
        try:
            raw_digests, image_id = raw.decode('utf-8').strip().rsplit('|', 1)
            digests = json.loads(raw_digests)
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            fail('無法確認本機 PostgreSQL 映像。')
        if not isinstance(digests, list) or expected_image_manifest not in digests or not re.fullmatch(r'sha256:[a-f0-9]{64}', image_id):
            fail('本機 PostgreSQL 映像與提供的 manifest digest 不符。')
        command(age, '--version', env=env)
        try:
            tty_fd = os.open('/dev/tty', os.O_RDWR | os.O_NOCTTY)
            tty = os.fdopen(tty_fd, 'w', buffering=1, encoding='utf-8')
        except OSError:
            fail('找不到互動終端，未要求私鑰。')
        with tty:
            if not os.isatty(tty.fileno()):
                fail('終端無法安全隱藏輸入，未要求私鑰。')
            print('工具、加密 ZIP 和本機 Docker 映像已核對。', file=tty, flush=True)
            print('請只在此本機終端輸入 age 私鑰；不要貼到聊天。', file=tty, flush=True)
            with warnings.catch_warnings():
                warnings.simplefilter('error', getpass.GetPassWarning)
                try:
                    identity = getpass.getpass('age 私鑰（不顯示）: ', stream=tty)
                except (EOFError, getpass.GetPassWarning, OSError):
                    fail('無法安全讀取隱藏輸入；已取消。')
        if not re.fullmatch(r'AGE-SECRET-KEY-1[023456789ACDEFGHJKLMNPQRSTUVWXYZ]{58}', identity):
            del identity
            fail('輸入格式不是支援的單行 age 私鑰；已取消。')
        identity_path = os.path.join(work, 'identity.txt')
        key_bytes = bytearray((identity + '\n').encode('ascii'))
        del identity
        try:
            key_fd = os.open(identity_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(key_fd, 'wb') as key_file:
                key_file.write(key_bytes)
        finally:
            for index in range(len(key_bytes)):
                key_bytes[index] = 0
        helper = os.path.join(helper_dir, 'restore-legacy-local.sh')
        inputs = f'{backup_path}\nsha256:{expected_zip_sha256}\n{identity_path}\n'.encode('utf-8')
        process = subprocess.Popen(['/bin/bash', helper], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, env=env, start_new_session=True)
        try:
            _stdout, _stderr = process.communicate(input=inputs)
        except BaseException:
            terminate_child(process)
            raise
        if process.returncode != 0:
            fail('隔離還原未通過；未輸出原始日誌或資料。請勿以此解除發布暫停。')
        raw_after = command(*docker_cmd, 'image', 'inspect', 'postgres:17-alpine', '--format', '{{.Id}}', env=env)
        if raw_after.decode('utf-8').strip() != image_id:
            fail('演練期間本機映像標籤已改變，不能採信結果。')
        print('隔離解密與 PostgreSQL 還原已完成。這不驗證來源身分或完整 Supabase 恢復，也不解除發布暫停。', flush=True)
    finally:
        terminate_child(process)
        os.close(source_fd)
        os.close(backup_fd)
        if work is not None:
            try:
                shutil.rmtree(work)
            except OSError:
                print('暫存清理未能確認；請在本機檢查 /dev/shm/sunrise-operator-*。', file=sys.stderr, flush=True)


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, on_signal)
    try:
        main(sys.argv[1:])
    except Abort as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print('操作已中斷；已嘗試清理本機暫存。', file=sys.stderr)
        sys.exit(130)
    except Exception:
        print('本機驗證或演練失敗；未顯示原始錯誤、私鑰或資料。', file=sys.stderr)
        sys.exit(1)
