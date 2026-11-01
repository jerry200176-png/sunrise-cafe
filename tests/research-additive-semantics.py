#!/usr/bin/env python3
"""Synthetic PostgreSQL evidence for #502 migration classification.

Runs only in a new, network-none, tmpfs PostgreSQL container. It demonstrates
generic Postgres semantics, not the existence or grants of production objects.
"""
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time

if sys.flags.optimize:
    raise SystemExit('Optimized Python is unsupported: checks must not be removed')
sock = os.stat('/var/run/docker.sock')
if not stat.S_ISSOCK(sock.st_mode) or sock.st_uid != 0:
    raise SystemExit('trusted local Docker socket is unavailable')
config = tempfile.mkdtemp(prefix='sunrise-additive-semantics-')
base = ['docker', '--config', config, '--host', 'unix:///var/run/docker.sock']
env = {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C'}
container = None
holder = None


def run(*args, input_text=None):
    result = subprocess.run(base + list(args), input=input_text, text=True, env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('synthetic fixture failed: ' + result.stderr[-1200:])
    return result.stdout.strip()


def sql(query):
    return run('exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At',
               input_text=query)


try:
    run('image', 'inspect', 'postgres:17-alpine')
    container = run('run', '-d', '--pull=never', '--log-driver=none', '--network', 'none',
                    '--tmpfs', '/var/lib/postgresql/data:rw,size=192m',
                    '-e', 'POSTGRES_PASSWORD=synthetic_local_password', 'postgres:17-alpine')
    for _ in range(120):
        check = subprocess.run(base + ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], env=env,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if check.returncode == 0:
            break
        time.sleep(.2)
    else:
        raise RuntimeError('isolated PostgreSQL did not start')
    sql("""
      CREATE ROLE synthetic_anon NOLOGIN;
      CREATE FUNCTION public.synthetic_existing() RETURNS integer LANGUAGE sql AS 'SELECT 1';
      CREATE OR REPLACE FUNCTION public.synthetic_existing() RETURNS integer LANGUAGE sql AS 'SELECT 2';
      DO $$ BEGIN
        IF public.synthetic_existing() <> 2 THEN RAISE EXCEPTION 'replace did not replace'; END IF;
        IF NOT has_function_privilege('synthetic_anon','public.synthetic_existing()','execute')
          THEN RAISE EXCEPTION 'expected default PUBLIC EXECUTE'; END IF;
      END $$;
      -- Plain CREATE refuses an existing signature instead of replacing it.
      DO $$ BEGIN
        BEGIN
          EXECUTE 'CREATE FUNCTION public.synthetic_existing() RETURNS integer LANGUAGE sql AS ''SELECT 99''';
          RAISE EXCEPTION 'duplicate CREATE unexpectedly succeeded';
        EXCEPTION WHEN duplicate_function THEN NULL;
        END;
        IF public.synthetic_existing() <> 2 THEN RAISE EXCEPTION 'duplicate CREATE changed existing function'; END IF;
      END $$;
      REVOKE ALL ON FUNCTION public.synthetic_existing() FROM PUBLIC;
      DO $$ BEGIN
        IF has_function_privilege('synthetic_anon','public.synthetic_existing()','execute')
          THEN RAISE EXCEPTION 'revoke did not change ACL'; END IF;
      END $$;
      CREATE TABLE public.synthetic_counter(value integer NOT NULL);
      INSERT INTO public.synthetic_counter VALUES (11);
      CREATE FUNCTION public.synthetic_future_update() RETURNS void LANGUAGE plpgsql AS $fn$
      BEGIN UPDATE public.synthetic_counter SET value = value + 1; END $fn$;
      DO $$ BEGIN
        IF (SELECT value FROM public.synthetic_counter) <> 11
          THEN RAISE EXCEPTION 'function creation executed its body'; END IF;
      END $$;
      BEGIN;
      SELECT public.synthetic_future_update();
      DO $$ BEGIN
        IF (SELECT value FROM public.synthetic_counter) <> 12
          THEN RAISE EXCEPTION 'function call did not update'; END IF;
      END $$;
      ROLLBACK;
      DO $$ BEGIN
        IF (SELECT value FROM public.synthetic_counter) <> 11
          THEN RAISE EXCEPTION 'transaction did not roll back'; END IF;
      END $$;
      CREATE TABLE public.synthetic_trigger_target(id integer PRIMARY KEY);
      CREATE FUNCTION public.synthetic_trigger_fn() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN RETURN NEW; END $fn$;
    """)
    holder = subprocess.Popen(base + ['exec', '-i', container, 'psql', '-U', 'postgres', '-v',
                                     'ON_ERROR_STOP=1', '-At'], env=env,
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    holder.stdin.write("SET application_name='synthetic_lock_holder'; BEGIN; "
                       "CREATE TRIGGER synthetic_trigger AFTER INSERT ON public.synthetic_trigger_target "
                       "FOR EACH ROW EXECUTE FUNCTION public.synthetic_trigger_fn(); "
                       "SELECT pg_sleep(6); COMMIT;\n")
    holder.stdin.close()
    active = False
    for _ in range(50):
        if sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='synthetic_lock_holder' AND state='active' AND query LIKE '%pg_sleep(6)%';") == '1':
            active = True
            break
        time.sleep(.05)
    if not active:
        raise RuntimeError('trigger lock holder did not reach its waiting point')
    blocked = subprocess.run(base + ['exec', '-i', container, 'psql', '-U', 'postgres', '-v',
                                     'ON_ERROR_STOP=1', '-At'], env=env, text=True,
                             input="SET lock_timeout='200ms'; INSERT INTO public.synthetic_trigger_target VALUES (1);",
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if blocked.returncode == 0 or 'lock timeout' not in blocked.stderr:
        raise RuntimeError('expected CREATE TRIGGER transaction to block concurrent insert')
    holder.wait(timeout=10)
    if holder.returncode:
        raise RuntimeError('trigger transaction failed: ' + holder.stderr.read()[-1000:])
    holder = None
    sql('INSERT INTO public.synthetic_trigger_target VALUES (1);')
    print('Synthetic PostgreSQL semantics passed: replace, default function ACL, revoke, deferred function UPDATE and CREATE TRIGGER lock.')
finally:
    if holder is not None and holder.poll() is None:
        holder.kill()
        holder.wait()
    if container is not None:
        subprocess.run(base + ['rm', '-f', container], env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    shutil.rmtree(config)
