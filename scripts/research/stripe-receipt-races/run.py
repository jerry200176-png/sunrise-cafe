#!/usr/bin/env python3
"""Synthetic receipt and refund races; never application code or production data."""
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
    actual=sql(query)
    if actual != expected: raise AssertionError('synthetic assertion failed: '+repr((actual,expected)))

def seed(rid):
    sql("INSERT INTO study_receipt.reservations VALUES ("+str(rid)+",'pending');"
        +"INSERT INTO study_receipt.intents VALUES ("+str(rid)+",'pi_"+str(rid)+"','pending',50000,'twd');")

def receive(eid,rid,kind,amount=50000,currency='twd',ref=None):
    assert re.fullmatch(r'[a-z0-9_-]+',eid) and kind in ('success','refund_full','partial')
    assert currency in ('twd','usd') and isinstance(amount,int)
    identifier='NULL' if rid is None else str(int(rid))
    intent='pi_unknown' if rid is None else ('pi_'+str(rid) if ref is None else ref)
    assert re.fullmatch(r'[a-z0-9_-]+',intent)
    return "SELECT study_receipt.receive_event('"+eid+"',"+identifier+",'"+intent+"','"+kind+"',"+str(amount)+",'"+currency+"');"

def apply(eid,fail=False):
    assert re.fullmatch(r'[a-z0-9_-]+',eid)
    return "SELECT study_receipt.apply_event('"+eid+"',"+str(fail).lower()+");"

def snapshot(rid):
    return sql("SELECT r.state||'|'||i.state||'|'||"
      "(SELECT count(*) FROM study_receipt.inbox WHERE reservation_id=r.id)||'|'||"
      "(SELECT count(*) FROM study_receipt.audit WHERE reservation_id=r.id AND kind='paid')||'|'||"
      "coalesce((SELECT state FROM study_receipt.outbox WHERE stable_key='paid:'||r.id),'none') "
      "FROM study_receipt.reservations r JOIN study_receipt.intents i ON i.reservation_id=r.id WHERE r.id="+str(rid))

def main():
    global CID
    run('docker','image','inspect',IMAGE)
    CID=validate_container_id(run('docker','run','-d','--pull=never','--network','none','--log-driver','none',
        '--tmpfs','/var/lib/postgresql/data:rw,size=256m','-e','POSTGRES_PASSWORD=synthetic-only-password',IMAGE).stdout.strip())
    cfg=json.loads(run('docker','inspect',CID).stdout)[0]
    assert cfg['HostConfig']['NetworkMode']=='none' and cfg['HostConfig']['LogConfig']['Type']=='none'
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
    assert 170000 <= int(sql('SHOW server_version_num')) < 180000
    sql((ROOT/'contract.sql').read_text())

    seed(1)
    check(receive('s1',1,'success'),'received'); check(receive('r1',1,'refund_full'),'received')
    race(apply('s1'),apply('r1'),'paid','refunded')
    assert snapshot(1)=='refunded|refunded|2|1|cancelled'
    seed(2)
    check(receive('s2',2,'success'),'received'); check(receive('r2',2,'refund_full'),'received')
    race(apply('r2'),apply('s2'),'refunded','reconciliation_required')
    assert snapshot(2)=='refunded|refunded|2|0|none'
    print('synthetic_receipt_first_and_success_refund_both_lock_orders=pass')

    seed(3)
    check(receive('s3',3,'success'),'received');check(apply('s3'),'paid');check(receive('r3',3,'refund_full'),'received')
    race('SELECT study_receipt.claim_paid(3);',apply('r3'),'claimed','refunded_delivery_reconcile')
    assert snapshot(3)=='refunded|refunded|2|1|claimed'
    seed(4)
    check(receive('s4',4,'success'),'received');check(apply('s4'),'paid');check(receive('r4',4,'refund_full'),'received')
    race(apply('r4'),'SELECT study_receipt.claim_paid(4);','refunded','not_claimed')
    assert snapshot(4)=='refunded|refunded|2|1|cancelled'
    print('synthetic_claim_refund_both_lock_orders=pass')
    print('limitation_claimed_effect_delivery_and_retraction_not_modeled=observed')

    seed(5)
    check(receive('s5a',5,'success'),'received'); check(receive('s5b',5,'success'),'received')
    check(receive('s5a',5,'success'),'duplicate')
    race(apply('s5a'),apply('s5b'),'paid','paid')
    assert snapshot(5)=='paid|succeeded|2|1|pending'
    check(receive('s5a',5,'success',10000),'conflict')
    check(receive('s5a',5,'success',10000),'conflict')
    check(receive('s5a',5,'success'),'duplicate_conflict')
    check("SELECT state FROM study_receipt.inbox WHERE event_id='s5a'",'conflict')
    check("SELECT count(*) FROM study_receipt.conflicts WHERE event_id='s5a'",'1')
    assert snapshot(5)=='paid|succeeded|2|1|pending'
    print('synthetic_duplicate_and_conflicting_identity=pass')
    print('limitation_conflict_after_apply_does_not_undo_prior_effects=observed')

    check(receive('unknown',None,'success'),'received')
    check(apply('unknown'),'reconciliation_required')
    check("SELECT state FROM study_receipt.inbox WHERE event_id='unknown'",'reconciliation_required')
    seed(6)
    check(receive('mismatch',6,'success',ref='pi_wrong'),'received')
    check(apply('mismatch'),'reconciliation_required')
    check(receive('partial',6,'partial',10000),'received')
    check(apply('partial'),'reconciliation_required')
    check(receive('wrong_amount',6,'success',10000),'received')
    check(apply('wrong_amount'),'reconciliation_required')
    check(receive('wrong_currency',6,'success',50000,'usd'),'received')
    check(apply('wrong_currency'),'reconciliation_required')
    assert snapshot(6)=='pending|pending|4|0|none'
    print('synthetic_unknown_binding_and_partial_evidence_preserved=pass')

    seed(7)
    check(receive('failure',7,'success'),'received')
    failed=run('docker','exec','-i',CID,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1',
        input=apply('failure',True)+'\n',check=False)
    assert failed.returncode != 0 and 'synthetic apply failure' in failed.stderr
    check("SELECT state FROM study_receipt.inbox WHERE event_id='failure'",'received')
    assert snapshot(7)=='pending|pending|1|0|none'
    check(apply('failure'),'paid')
    assert snapshot(7)=='paid|succeeded|1|1|pending'
    before=sql('SELECT count(*) FROM study_receipt.inbox')
    receive_failed=run('docker','exec','-i',CID,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1',
      input="SELECT study_receipt.receive_event(NULL,7,'pi_7','success',50000,'twd');\n",check=False)
    assert receive_failed.returncode != 0
    check('SELECT count(*) FROM study_receipt.inbox',before)
    print('synthetic_committed_receipt_survives_apply_rollback=pass')
    print('limitation_receive_failure_has_no_durable_receipt=observed')
    print('LIMITATIONS: no real signature, app RPC, live migration, external effects, production data, providers, policies or existing writers tested')

if __name__=='__main__':
    try:
        validate_socket_info(os.stat('/var/run/docker.sock'))
        with tempfile.TemporaryDirectory(prefix='sunrise-receipt-study-docker-config-') as config:
            DOCKER_CONFIG=config
            try: main()
            finally:
                for session in SESSIONS: session.close()
                if CID: run('docker','rm','-f',CID,check=False)
    except OSError as error:
        raise SystemExit('local Docker setup unavailable') from error
