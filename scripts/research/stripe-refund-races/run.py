#!/usr/bin/env python3
"""Disposable PG17 refund-race study; never production code, data, or providers."""
import json
import os
import queue
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
IMAGE = 'postgres:17-alpine'
CID = None
SESSIONS = []
COUNTER = 0
DOCKER_CONFIG = None
DOCKER_BIN = shutil.which('docker', path='/usr/local/bin:/usr/bin:/bin')
SAFE_ENV = {'PATH':'/usr/local/bin:/usr/bin:/bin', 'LANG':'C.UTF-8'}

def validate_socket_info(socket_info):
    if not stat.S_ISSOCK(socket_info.st_mode) or socket_info.st_uid != 0:
        raise RuntimeError('root-owned local Docker socket unavailable')

def validate_container_id(value):
    if not re.fullmatch(r'[0-9a-f]{64}', value):
        raise RuntimeError('unexpected synthetic container identity')
    return value

def docker_command(*args):
    if not DOCKER_BIN or not DOCKER_CONFIG:
        raise RuntimeError('trusted local Docker setup unavailable')
    return [DOCKER_BIN,'--host','unix:///var/run/docker.sock','--config',DOCKER_CONFIG,*args]

def run(*cmd, input=None, check=True):
    if not cmd or cmd[0] != 'docker': raise RuntimeError('unexpected subprocess')
    return subprocess.run(docker_command(*cmd[1:]), env=SAFE_ENV, input=input, capture_output=True, text=True, check=check, timeout=30)

def sql(query):
    return run('docker','exec','-i',CID,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1', input=query+'\n').stdout.strip()

class Session:
    def __init__(self, app):
        self.app=app
        self.proc=subprocess.Popen(docker_command('exec','-i','-e','PGAPPNAME='+app,CID,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'),env=SAFE_ENV,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
        self.lines=queue.Queue()
        threading.Thread(target=self._read,daemon=True).start()
        SESSIONS.append(self)
    def _read(self):
        for line in self.proc.stdout:
            self.lines.put(line.rstrip('\n'))
        self.lines.put(None)
    def send(self, text, tag):
        self.proc.stdin.write(text+'\n\\echo '+tag+'\n')
        self.proc.stdin.flush()
    def receive(self, tag, timeout=15):
        output=[]
        end=time.monotonic()+timeout
        while True:
            try: line=self.lines.get(timeout=max(0.01,end-time.monotonic()))
            except queue.Empty: raise AssertionError('synthetic session timed out')
            if line is None: raise AssertionError('synthetic psql exited: '+repr(output))
            if line == tag: return output
            output.append(line)
    def execute(self,text,tag):
        self.send(text,tag)
        return self.receive(tag)
    def close(self):
        if self.proc.poll() is None:
            try: self.proc.stdin.write('\\q\n'); self.proc.stdin.flush(); self.proc.wait(timeout=3)
            except Exception: self.proc.kill(); self.proc.wait(timeout=3)

def wait_for_block(waiter_app, blocker_app):
    deadline=time.monotonic()+8
    while time.monotonic()<deadline:
        state=sql("SELECT EXISTS (SELECT 1 FROM pg_stat_activity waiter JOIN pg_stat_activity blocker ON blocker.application_name='"+blocker_app+"' WHERE waiter.application_name='"+waiter_app+"' AND waiter.state='active' AND waiter.wait_event_type='Lock' AND blocker.xact_start IS NOT NULL AND blocker.pid=ANY(pg_blocking_pids(waiter.pid)))::text;")
        if state=='true': return
        time.sleep(.05)
    raise AssertionError('second synthetic session never observed waiting on a lock')

def race(winner_sql, loser_sql, expected_winner, expected_loser):
    global COUNTER
    COUNTER+=1
    a=Session('study_a_'+str(COUNTER))
    b=Session('study_b_'+str(COUNTER))
    try:
        assert a.execute('BEGIN;\n'+winner_sql,'A_READY') == [expected_winner]
        b.send('BEGIN;\n'+loser_sql,'B_READY')
        wait_for_block(b.app,a.app)
        assert a.execute('COMMIT;','A_COMMIT') == []
        assert b.receive('B_READY') == [expected_loser]
        assert b.execute('COMMIT;','B_COMMIT') == []
        return expected_winner, expected_loser
    finally:
        a.close(); b.close()

def check(query, expected):
    actual = sql(query)
    if actual != expected:
        raise AssertionError('synthetic assertion failed: '+repr((actual, expected)))

def seed(rid):
    sql("INSERT INTO study_refund.reservations VALUES ("+str(rid)+",'pending');"
        +"INSERT INTO study_refund.intents VALUES ("+str(rid)+",'pending',50000,'twd');")

def event(rid, event_id, kind, amount=50000, currency='twd', fail=False):
    assert re.fullmatch(r'[a-z0-9_-]+', event_id) and kind in ('success','refund_full','partial')
    assert currency in ('twd','usd') and isinstance(amount, int)
    return ("SELECT study_refund.apply_event("+str(rid)+",'"+event_id+"','"+kind+"',"
            +str(amount)+",'"+currency+"',"+str(fail).lower()+");")

def snapshot(rid):
    return sql("SELECT r.deposit_state||'|'||i.state||'|'||"
      "(SELECT count(*) FROM study_refund.events WHERE reservation_id=r.id)||'|'||"
      "(SELECT count(*) FROM study_refund.audit WHERE reservation_id=r.id AND kind='paid')||'|'||"
      "(SELECT count(*) FROM study_refund.outbox WHERE reservation_id=r.id AND kind='paid') "
      "FROM study_refund.reservations r JOIN study_refund.intents i ON i.reservation_id=r.id WHERE r.id="+str(rid))

def main():
    global CID
    run('docker','image','inspect',IMAGE)
    CID=validate_container_id(run('docker','run','-d','--pull=never','--network','none','--log-driver','none',
        '--tmpfs','/var/lib/postgresql/data:rw,size=256m','-e','POSTGRES_PASSWORD=synthetic-only-password',IMAGE).stdout.strip())
    cfg=json.loads(run('docker','inspect',CID).stdout)[0]
    assert cfg['HostConfig']['NetworkMode']=='none'
    assert cfg['HostConfig']['LogConfig']['Type']=='none'
    assert '/var/lib/postgresql/data' in cfg['HostConfig']['Tmpfs']
    assert not cfg['HostConfig'].get('PortBindings')
    assert not any(m['Type'] in ('bind','volume') for m in cfg.get('Mounts',[]))
    deadline=time.monotonic()+35
    while time.monotonic()<deadline:
        pid1=run('docker','exec',CID,'cat','/proc/1/comm',check=False)
        ready=run('docker','exec',CID,'pg_isready','-U','postgres',check=False)
        if pid1.returncode==0 and pid1.stdout.strip()=='postgres' and ready.returncode==0: break
        time.sleep(.1)
    else: raise AssertionError('disposable postgres failed to start')
    version=int(sql('SHOW server_version_num'))
    assert 170000 <= version < 180000, 'synthetic proof requires PostgreSQL 17'
    sql((ROOT/'contract.sql').read_text())

    seed(1)
    race(event(1,'success_1','success'),event(1,'refund_1','refund_full'),'paid','refunded')
    assert snapshot(1)=='refunded|refunded|2|1|1'
    seed(2)
    race(event(2,'refund_2','refund_full'),event(2,'success_2','success'),'refunded','reconciliation_required')
    assert snapshot(2)=='refunded|refunded|2|0|0'
    check("SELECT outcome FROM study_refund.events WHERE event_id='success_2'",'reconciliation_required')
    print('synthetic_success_refund_both_lock_orders=pass')
    print('limitation_paid_outbox_can_remain_after_later_refund=observed')

    seed(3)
    race(event(3,'success_3','success'),event(3,'success_3','success'),'paid','paid')
    assert snapshot(3)=='paid|succeeded|1|1|1'
    check(event(3,'success_3','success',10000),'conflict')
    check("SELECT count(*) FROM study_refund.conflicts WHERE event_id='success_3'",'1')
    assert snapshot(3)=='paid|succeeded|1|1|1'
    seed(6)
    race(event(6,'success_6a','success'),event(6,'success_6b','success'),'paid','paid')
    assert snapshot(6)=='paid|succeeded|2|1|1'
    check(event(6,'success_3','success'),'conflict')
    check("SELECT count(*) FROM study_refund.conflicts WHERE event_id='success_3'",'2')
    assert snapshot(6)=='paid|succeeded|2|1|1'
    print('synthetic_duplicate_and_conflicting_event=pass')

    seed(4)
    check(event(4,'partial_4','partial',10000),'reconciliation_required')
    check(event(4,'wrong_currency_4','success',50000,'usd'),'reconciliation_required')
    assert snapshot(4)=='pending|pending|2|0|0'
    print('synthetic_unknown_amount_currency_or_kind_stays_reconciliation=pass')

    seed(5)
    failed=run('docker','exec','-i',CID,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1',
        input=event(5,'failure_5','success',fail=True)+'\n',check=False)
    assert failed.returncode != 0 and 'synthetic transaction failure' in failed.stderr
    assert snapshot(5)=='pending|pending|0|0|0'
    check(event(5,'failure_5','success'),'paid')
    assert snapshot(5)=='paid|succeeded|1|1|1'
    unknown=run('docker','exec','-i',CID,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1',
        input=event(999,'unknown_binding','success')+'\n',check=False)
    assert unknown.returncode != 0
    check("SELECT count(*) FROM study_refund.events WHERE event_id='unknown_binding'",'0')
    print('synthetic_failure_rolls_back_then_retry=pass')
    print('limitation_unknown_binding_not_durably_received=observed')
    print('LIMITATIONS: no app RPC, live migration, unknown binding, historical policy, partial refund semantics, production data, real provider or notification tested')

if __name__=='__main__':
    try:
        validate_socket_info(os.stat('/var/run/docker.sock'))
        with tempfile.TemporaryDirectory(prefix='sunrise-refund-study-docker-config-') as config:
            DOCKER_CONFIG=config
            try: main()
            finally:
                for session in SESSIONS: session.close()
                if CID: run('docker','rm','-f',CID,check=False)
    except OSError as error:
        raise SystemExit('local Docker setup unavailable') from error
