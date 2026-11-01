#!/usr/bin/env python3
"""Isolated research fixture only; never talks to Sunrise, Stripe, LINE, or production."""
import json
import os
import queue
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
IMAGE = 'postgres:17-alpine'
CID = None
SESSIONS = []
COUNTER = 0

def run(*cmd, input=None, check=True):
    return subprocess.run(cmd, input=input, capture_output=True, text=True, check=check, timeout=30)

def sql(query):
    return run('docker','exec','-i',CID,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1', input=query+'\n').stdout.strip()

class Session:
    def __init__(self, app):
        self.app=app
        self.proc=subprocess.Popen(['docker','exec','-i','-e','PGAPPNAME='+app,CID,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
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

def seed(rid, paid='false'):
    sql('INSERT INTO study.reservations(id,status,paid) VALUES ('+str(rid)+",'pending',"+paid+');')

def check(query, expected):
    actual=sql(query)
    if actual!=expected: raise AssertionError('synthetic assertion failed: expected '+repr(expected)+' got '+repr(actual))

def main():
    global CID
    run('docker','image','inspect',IMAGE)
    CID=run('docker','run','-d','--network','none','--log-driver','none','--tmpfs','/var/lib/postgresql/data:rw,size=256m','-e','POSTGRES_PASSWORD=synthetic-only-password',IMAGE).stdout.strip()
    cfg=json.loads(run('docker','inspect',CID).stdout)[0]
    assert cfg['HostConfig']['NetworkMode']=='none'
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
    version=int(sql("SHOW server_version_num"))
    assert 170000 <= version < 180000, 'synthetic proof requires PostgreSQL 17'
    sql((ROOT/'contract.sql').read_text())

    # Two sessions and an observed PostgreSQL lock wait in BOTH winner orders.
    seed(1,'NULL')
    race('SELECT study.cancel(1);','SELECT study.check_in(1);','cancelled','stale')
    check("SELECT status||'|'||coalesce(paid::text,'NULL')||'|'||(SELECT count(*) FROM study.events WHERE reservation_id=1)||'|'||(SELECT count(*) FROM study.outbox WHERE reservation_id=1) FROM study.reservations WHERE id=1",'cancelled|NULL|1|1')
    seed(2,'NULL')
    race('SELECT study.check_in(2);','SELECT study.cancel(2);','checked_in','stale')
    check("SELECT status||'|'||coalesce(paid::text,'NULL')||'|'||(SELECT count(*) FROM study.events WHERE reservation_id=2)||'|'||(SELECT count(*) FROM study.outbox WHERE reservation_id=2) FROM study.reservations WHERE id=2",'checked_in|NULL|1|1')
    print('cancel_checkin_both_orders_lock_wait_one_effect_paid_null_unchanged=pass',flush=True)

    # First claim must commit before a caller would invoke a provider; the driver
    # only models the provider call count, and never calls a payment provider.
    class FakeProvider:
        def __init__(self): self.calls=0
        def call(self): self.calls+=1
    rid=10
    for provider in ('stripe','linepay'):
        for state in ('creating','pending','confirming','unknown'):
            seed(rid)
            fake_provider=FakeProvider()
            winner_sql=("SELECT study.claim("+str(rid)+",'"+provider+"','creating');\n"
                +"UPDATE study.attempts SET state='"+state+"' WHERE reservation_id="+str(rid)+" AND provider='"+provider+"';")
            claim_result,_=race(winner_sql,'SELECT study.cancel('+str(rid)+');','claimed','deferred')
            if claim_result=='claimed' and state=='creating': fake_provider.call()  # new claim committed; never retry unknown
            assert fake_provider.calls==(1 if state=='creating' else 0)
            check("SELECT status||'|'||(SELECT count(*) FROM study.events WHERE reservation_id="+str(rid)+") FROM study.reservations WHERE id="+str(rid),'pending|0')
            duplicate_result=sql("SELECT study.claim("+str(rid)+",'"+provider+"','creating')")
            if duplicate_result=='claimed': fake_provider.call()
            assert duplicate_result=='duplicate' and fake_provider.calls==(1 if state=='creating' else 0)
            rid+=1
        seed(rid)
        fake_provider=FakeProvider()
        _,claim_result=race('SELECT study.cancel('+str(rid)+');',"SELECT study.claim("+str(rid)+",'"+provider+"','creating');",'cancelled','rejected')
        if claim_result=='claimed': fake_provider.call()
        check('SELECT count(*) FROM study.attempts WHERE reservation_id='+str(rid),'0')
        assert fake_provider.calls==0
        rid+=1
    print('claim_cancel_both_providers_unresolved_states_defer_cancel_winner_rejects_claim=pass',flush=True)

    seed(30)
    check("SELECT study.claim(30,'stripe','creating')",'claimed')
    sql("UPDATE study.attempts SET state='pending' WHERE reservation_id=30 AND provider='stripe'")
    race("SELECT study.provider_success(30,'stripe','stripe-event-30');",'SELECT study.cancel(30);','paid','paid')
    check("SELECT status||'|'||paid::text||'|'||(SELECT count(*) FROM study.provider_evidence WHERE reservation_id=30) FROM study.reservations WHERE id=30",'pending|true|1')
    seed(31)
    race('SELECT study.cancel(31);',"SELECT study.provider_success(31,'linepay','line-event-31');",'cancelled','reconciliation_required')
    check("SELECT status||'|'||paid::text||'|'||(SELECT count(*) FROM study.provider_evidence WHERE reservation_id=31)||'|'||(SELECT count(*) FROM study.outbox WHERE reservation_id=31 AND kind='paid') FROM study.reservations WHERE id=31",'cancelled|false|1|0')
    check("SELECT study.provider_success(31,'linepay','line-event-31')",'reconciliation_required')
    check("SELECT count(*) FROM study.provider_evidence WHERE reservation_id=31",'1')
    seed(41)
    race("SELECT study.provider_success(41,'stripe','stripe-event-41');","SELECT study.provider_success(41,'stripe','stripe-event-41');",'paid','paid')
    check("SELECT (SELECT count(*) FROM study.provider_evidence WHERE reservation_id=41)||'|'||(SELECT count(*) FROM study.outbox WHERE reservation_id=41 AND kind='paid')",'1|1')
    print('payment_cancel_both_orders_late_success_and_concurrent_duplicate_event=pass',flush=True)

    seed(40)
    failed=run('docker','exec','-i',CID,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1',input='SELECT study.cancel(40,true);\n',check=False)
    assert failed.returncode!=0 and 'synthetic outbox failure' in failed.stderr
    check("SELECT status||'|'||(SELECT count(*) FROM study.events WHERE reservation_id=40)||'|'||(SELECT count(*) FROM study.outbox WHERE reservation_id=40) FROM study.reservations WHERE id=40",'pending|0|0')
    check('SELECT study.cancel(40)', 'cancelled')
    check('SELECT study.cancel(40)', 'stale')
    check("SELECT count(*) FROM study.outbox WHERE reservation_id=40",'1')
    print('outbox_failure_transaction_rolls_back_and_retry_is_unique=pass',flush=True)

    sql("INSERT INTO study.slot_claims VALUES (1,1,'cancelled',tstzrange('2030-01-01 10:00+00','2030-01-01 11:00+00','[)')), (3,2,'cancelled',tstzrange('2030-01-01 10:00+00','2030-01-01 11:00+00','[)'))")
    race('SELECT study.create_slot(2,1);','SELECT study.restore_slot(1);','created','slot_conflict')
    check("SELECT status FROM study.slot_claims WHERE id=1",'cancelled')
    race('SELECT study.restore_slot(3);','SELECT study.create_slot(4,2);','restored','slot_conflict')
    check("SELECT count(*) FROM study.slot_claims WHERE id=4",'0')
    print('slot_exclusion_restore_vs_new_both_orders_no_overlap=pass',flush=True)
    print('CONTRACT_FIXTURE_ONLY: no application RPC, provider, notification, or production data tested',flush=True)

if __name__=='__main__':
    try: main()
    finally:
        for session in SESSIONS: session.close()
        if CID: run('docker','rm','-f',CID,check=False)
