"""Controlled interleavings against the candidate migration on a disposable fixture."""
import subprocess
import sys
import time

container_id = sys.argv[1]
reservation = '00000000-0000-0000-0000-000000000008'
order = '00000000-0000-0000-0000-000000000009'
item = '00000000-0000-0000-0000-000000000010'
menu = '00000000-0000-0000-0000-000000000003'
base = ['docker', 'exec', '-i', container_id, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At']

def run(sql):
    return subprocess.run(base, input=sql, text=True, capture_output=True, check=True).stdout.strip()

def start(sql):
    proc = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    proc.stdin.write(sql)
    proc.stdin.close()
    return proc

def wait_sleep(app):
    for _ in range(100):
        if run(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{app}' AND wait_event='PgSleep'") == '1':
            return
        time.sleep(0.05)
    raise AssertionError(f'{app} did not reach the controlled sleep')

def wait_lock(app):
    for _ in range(50):
        if run(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{app}' AND wait_event_type='Lock'") == '1':
            return
        time.sleep(0.05)
    raise AssertionError(f'{app} did not block on the transaction lock')

def finish(proc):
    rc = proc.wait(timeout=10)
    stderr = proc.stderr.read()
    if rc:
        raise AssertionError(stderr)

run(f"""INSERT INTO reservations VALUES ('{reservation}','checked_in');
INSERT INTO orders(id,reservation_id) VALUES ('{order}','{reservation}');
INSERT INTO order_items(id,order_id,menu_item_id,item_name,quantity,unit_price)
VALUES ('{item}','{order}','{menu}','existing',1,100);""")

items = f'''[{{"menu_item_id":"{menu}","item_name":"new","quantity":1,"unit_price":100,"selected_options":[]}}]'''
add = f"SELECT public.add_reservation_order_items_once('{reservation}','{order}','serve-add-key-000001',repeat('e',64),'{items}'::jsonb);"

# An old all-served snapshot must not overwrite a status after a new add.
run(f"UPDATE order_items SET served_at=now() WHERE id='{item}';")
snapshot = run(f"SELECT bool_and(served_at IS NOT NULL) FROM order_items WHERE order_id='{order}';")
assert snapshot == 't'
run(add)
run(f"UPDATE orders SET status='ready' WHERE id='{order}';")
assert run(f"SELECT status FROM orders WHERE id='{order}'") == 'preparing'
assert run(f"SELECT count(*) FROM order_items WHERE order_id='{order}' AND served_at IS NULL") == '1'

# Disposable reset. Exercise the item guard and status triggers, without a
# custom application-side status refresh or a synthetic serve RPC.
run(f"DELETE FROM reservation_order_add_requests WHERE reservation_id='{reservation}'; DELETE FROM order_items WHERE order_id='{order}' AND id <> '{item}'; UPDATE order_items SET served_at=NULL WHERE id='{item}'; UPDATE orders SET status='pending' WHERE id='{order}';")
serve = start(f"""SET application_name='fixture_serve'; BEGIN;
UPDATE order_items SET served_at=now() WHERE id='{item}';
SELECT pg_sleep(3); COMMIT;""")
try:
    wait_sleep('fixture_serve')
    concurrent_add = start("SET application_name='fixture_wait_add'; " + add)
    wait_lock('fixture_wait_add')
    finish(serve)
    finish(concurrent_add)
    assert run(f"SELECT status FROM orders WHERE id='{order}'") == 'preparing'
    assert run(f"SELECT count(*) FROM order_items WHERE order_id='{order}' AND served_at IS NULL") == '1'
finally:
    if serve.poll() is None:
        serve.terminate()

# Reverse the lock acquisition order: add holds both locks until commit and
# serve must see its new unserved row before calculating the final status.
run(f"DELETE FROM reservation_order_add_requests WHERE reservation_id='{reservation}'; DELETE FROM order_items WHERE order_id='{order}' AND id <> '{item}'; UPDATE order_items SET served_at=NULL WHERE id='{item}'; UPDATE orders SET status='pending' WHERE id='{order}';")
adding = start(f"SET application_name='fixture_add'; BEGIN; {add} SELECT pg_sleep(3); COMMIT;")
try:
    wait_sleep('fixture_add')
    concurrent_serve = start(f"""SET application_name='fixture_wait_serve'; BEGIN;
UPDATE order_items SET served_at=now() WHERE id='{item}';
COMMIT;""")
    wait_lock('fixture_wait_serve')
    finish(adding)
    finish(concurrent_serve)
    assert run(f"SELECT status FROM orders WHERE id='{order}'") == 'preparing'
    assert run(f"SELECT count(*) FROM order_items WHERE order_id='{order}' AND served_at IS NULL") == '1'
finally:
    if adding.poll() is None:
        adding.terminate()

# Legacy status UPDATE may start before the add commits and wait on its row
# lock. The BEFORE trigger must still see the committed add after waiting.
run(f"DELETE FROM reservation_order_add_requests WHERE reservation_id='{reservation}'; DELETE FROM order_items WHERE order_id='{order}' AND id <> '{item}'; UPDATE order_items SET served_at=now() WHERE id='{item}';")
adding = start(f"SET application_name='fixture_add_stale'; BEGIN; {add} SELECT pg_sleep(3); COMMIT;")
try:
    wait_sleep('fixture_add_stale')
    stale = start(f"SET application_name='fixture_wait_stale'; UPDATE orders SET status='ready' WHERE id='{order}';")
    wait_lock('fixture_wait_stale')
    finish(adding)
    finish(stale)
    assert run(f"SELECT status FROM orders WHERE id='{order}'") == 'preparing', 'stale blocked UPDATE overwrote new item state'
finally:
    if adding.poll() is None:
        adding.terminate()

# Model the existing settlement lock order and paid_at write. The real payment
# RPC is not part of this minimal fixture; no payment records are created.
run(f"DELETE FROM reservation_order_add_requests WHERE reservation_id='{reservation}'; DELETE FROM order_items WHERE order_id='{order}' AND id <> '{item}'; UPDATE order_items SET served_at=now() WHERE id='{item}'; UPDATE orders SET paid_at=NULL WHERE id='{order}';")
settling = start(f"""SET application_name='fixture_settle'; BEGIN;
SELECT id FROM reservations WHERE id='{reservation}' FOR UPDATE;
SELECT id FROM orders WHERE id='{order}' FOR UPDATE;
UPDATE orders SET paid_at=now() WHERE id='{order}';
UPDATE reservations SET status='completed' WHERE id='{reservation}';
SELECT pg_sleep(3); COMMIT;""")
try:
    wait_sleep('fixture_settle')
    concurrent_add = start("SET application_name='fixture_wait_add_checkout'; " + add)
    wait_lock('fixture_wait_add_checkout')
    finish(settling)
    assert concurrent_add.wait(timeout=10) != 0
    assert 'order_cannot_add' in concurrent_add.stderr.read()
    assert run(f"SELECT status FROM orders WHERE id='{order}'") == 'completed'
    assert run(f"SELECT count(*) FROM order_items WHERE order_id='{order}'") == '1'
finally:
    if settling.poll() is None:
        settling.terminate()

# A stale settlement amount must be rejected if an add held the lock first.
# This models the amount comparison, not the full production settlement RPC.
run(f"UPDATE reservations SET status='checked_in' WHERE id='{reservation}'; UPDATE orders SET paid_at=NULL WHERE id='{order}'; UPDATE order_items SET served_at=NULL WHERE id='{item}'; DELETE FROM reservation_order_add_requests WHERE reservation_id='{reservation}'; UPDATE orders SET total_amount=100 WHERE id='{order}';")
adding = start(f"SET application_name='fixture_add_before_settle'; BEGIN; {add} SELECT pg_sleep(3); COMMIT;")
try:
    wait_sleep('fixture_add_before_settle')
    stale_settle = start(f"""SET application_name='fixture_wait_settle'; BEGIN;
SELECT id FROM reservations WHERE id='{reservation}' FOR UPDATE;
SELECT id FROM orders WHERE id='{order}' FOR UPDATE;
DO $$ BEGIN IF (SELECT total_amount FROM orders WHERE id='{order}') <> 100 THEN RAISE EXCEPTION 'amount_changed'; END IF; END $$;
UPDATE orders SET paid_at=now() WHERE id='{order}'; COMMIT;""")
    wait_lock('fixture_wait_settle')
    finish(adding)
    assert stale_settle.wait(timeout=10) != 0
    assert 'amount_changed' in stale_settle.stderr.read()
    assert run(f"SELECT paid_at IS NULL FROM orders WHERE id='{order}'") == 't'
finally:
    if adding.poll() is None:
        adding.terminate()

# Tombstone vs the original add: whichever owns the reservation lock first
# determines the durable result, even if the first response was lost.
run(f"UPDATE reservations SET status='checked_in' WHERE id='{reservation}'; UPDATE orders SET paid_at=NULL WHERE id='{order}'; UPDATE order_items SET served_at=NULL WHERE id='{item}'; DELETE FROM reservation_order_add_requests WHERE reservation_id='{reservation}'; DELETE FROM order_items WHERE order_id='{order}' AND id <> '{item}';")
cancel = f"SELECT public.cancel_reservation_order_add('{reservation}','{order}','serve-add-key-000001');"
canceling = start(f"SET application_name='fixture_cancel'; BEGIN; {cancel} SELECT pg_sleep(3); COMMIT;")
try:
    wait_sleep('fixture_cancel')
    late_add = start("SET application_name='fixture_wait_late_add'; " + add)
    wait_lock('fixture_wait_late_add')
    finish(canceling)
    assert late_add.wait(timeout=10) != 0
    assert 'add_request_canceled' in late_add.stderr.read()
    assert run(f"SELECT state FROM reservation_order_add_requests WHERE reservation_id='{reservation}'") == 'canceled'
    assert run(f"SELECT count(*) FROM order_items WHERE order_id='{order}'") == '1'
finally:
    if canceling.poll() is None:
        canceling.terminate()

run(f"DELETE FROM reservation_order_add_requests WHERE reservation_id='{reservation}';")
adding = start(f"SET application_name='fixture_add_cancel'; BEGIN; {add} SELECT pg_sleep(3); COMMIT;")
try:
    wait_sleep('fixture_add_cancel')
    late_cancel = start("SET application_name='fixture_wait_cancel'; " + cancel)
    wait_lock('fixture_wait_cancel')
    finish(adding)
    finish(late_cancel)
    assert '"state": "committed"' in late_cancel.stdout.read()
    assert run(f"SELECT count(*) FROM order_items WHERE order_id='{order}'") == '2'
finally:
    if adding.poll() is None:
        adding.terminate()
run(f"DELETE FROM reservation_order_add_requests WHERE reservation_id='{reservation}'; DELETE FROM order_items WHERE order_id='{order}'; DELETE FROM orders WHERE id='{order}'; DELETE FROM reservations WHERE id='{reservation}';")
print('Controlled stale-status, serve/add, paid/add and cancel/add races passed (fixture only).')
