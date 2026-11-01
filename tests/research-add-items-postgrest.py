#!/usr/bin/env python3
"""Run candidate add-items RPC through isolated PostgREST and Postgres.

Only preloaded Docker images and synthetic data/credentials are used. PostgreSQL
owns a network namespace with no external network or host port; PostgREST and
Node share that namespace. This does not verify production roles or the web app.
"""
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import time

if sys.flags.optimize:
    raise SystemExit("Optimized Python is unsupported: checks must not be removed")
if len(sys.argv) != 2 or not Path(sys.argv[1]).is_absolute():
    raise SystemExit("usage: python3 tests/research-add-items-postgrest.py /absolute/node_modules")
modules = Path(sys.argv[1]).resolve(strict=True)
if not (modules / "@supabase/supabase-js/package.json").is_file():
    raise SystemExit("supabase-js is required in the supplied node_modules")
socket = os.stat("/var/run/docker.sock")
if not stat.S_ISSOCK(socket.st_mode) or socket.st_uid != 0:
    raise SystemExit("trusted local Docker socket is unavailable")

root = Path(__file__).resolve().parent.parent
config = tempfile.mkdtemp(prefix="sunrise-add-postgrest-")
docker = ["docker", "--config", config, "--host", "unix:///var/run/docker.sock"]
env = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C"}
containers = []


def run(*args, input_text=None):
    result = subprocess.run(docker + list(args), input=input_text, text=True,
                            env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        print("Synthetic Docker operation failed:", result.stderr[-1600:], file=sys.stderr)
        raise RuntimeError("isolated fixture failed")
    return result.stdout.strip()


def start(*args):
    container_id = run("run", "-d", "--pull=never", "--log-driver=none", *args)
    containers.append(container_id)
    return container_id


try:
    for image in ("postgres:17-alpine", "postgrest/postgrest:v12.2.12", "node:22-alpine"):
        run("image", "inspect", image)
    pg = start("--network", "none", "--tmpfs", "/var/lib/postgresql/data:rw,size=256m",
               "-e", "POSTGRES_PASSWORD=synthetic_local_password", "postgres:17-alpine")
    ready = False
    for _ in range(120):
        status = subprocess.run(docker + ["exec", pg, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
                                env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if status.returncode == 0:
            ready = True
            break
        time.sleep(0.2)
    if not ready:
        raise RuntimeError("isolated PostgreSQL did not start")
    for name in ("tests/fixtures/reservation-add-schema.sql",
                 "supabase/migrations/20261031173613_reservation_order_add_items_idempotency.sql"):
        run("exec", "-i", pg, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q",
            input_text=(root / name).read_text())
    start("--network", "container:" + pg,
          "-e", "PGRST_DB_URI=postgres://postgres:synthetic_local_password@127.0.0.1:5432/postgres",
          "-e", "PGRST_DB_SCHEMAS=public", "-e", "PGRST_DB_ANON_ROLE=anon",
          "-e", "PGRST_JWT_SECRET=synthetic_secret_12345678901234567890",
          "postgrest/postgrest:v12.2.12")
    result = run("run", "--rm", "-i", "--pull=never", "--network", "container:" + pg,
                 "--log-driver=none", "-v", str(modules) + ":/fixture/node_modules:ro",
                 "node:22-alpine", "node", "-",
                 input_text=(root / "tests/research-add-items-postgrest.cjs").read_text())
    print(result)
finally:
    for container_id in reversed(containers):
        subprocess.run(docker + ["rm", "-f", container_id], env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    shutil.rmtree(config)
