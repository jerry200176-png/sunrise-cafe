"""Race actual repository settlement RPC + guard/total triggers with candidate add RPC.
Run only from the network-isolated Docker launcher, with synthetic rows.
"""
import subprocess
import sys
import time

if sys.flags.optimize:
    raise SystemExit('Optimized Python is unsupported: checks must not be removed')

cid = sys.argv[1]
base = ['docker', 'exec', '-i', cid, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At']

def run(sql):
    return subprocess.run(base, input=sql, text=True, capture_output=True, check=True).stdout.strip()

def start(sql):
    proc = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    proc.stdin.write(sql)
    proc.stdin.close()
    return proc

def wait_for(app, condition):
    for _ in range(100):
        if run(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{app}' AND {condition}") == '1':
            return
        time.sleep(.05)
    raise AssertionError(f'{app} did not reach {condition}')

def finish(proc):
    code = proc.wait(timeout=10)
    stderr = proc.stderr.read()
    if code:
        raise AssertionError(stderr)

def must_fail(proc, error):
    code = proc.wait(timeout=10)
    stderr = proc.stderr.read()
    assert code != 0 and error in stderr, (code, stderr)

branch='20000000-0000-0000-0000-000000000001'
room='20000000-0000-0000-0000-000000000002'
menu='20000000-0000-0000-0000-000000000003'
res1='20000000-0000-0000-0000-000000000004'
ord1='20000000-0000-0000-0000-000000000005'
res2='20000000-0000-0000-0000-000000000006'
ord2='20000000-0000-0000-0000-000000000007'
run(f"""INSERT INTO branches(id,name) VALUES ('{branch}','synthetic');
INSERT INTO rooms(id,branch_id,name,capacity,price_weekday,price_weekend) VALUES ('{room}','{branch}','synthetic',4,200,200);
INSERT INTO menu_items(id,branch_id,name,price) VALUES ('{menu}','{branch}','synthetic meal',100);
INSERT INTO reservations(id,room_id,customer_name,phone,start_time,end_time,status,total_price,is_deposit_paid) VALUES
  ('{res1}','{room}','synthetic','000','2026-10-01 10:00Z','2026-10-01 12:00Z','checked_in',400,false),
  ('{res2}','{room}','synthetic','000','2026-10-02 10:00Z','2026-10-02 12:00Z','checked_in',400,false);
INSERT INTO orders(id,branch_id,reservation_id) VALUES ('{ord1}','{branch}','{res1}'),('{ord2}','{branch}','{res2}');
INSERT INTO order_items(order_id,menu_item_id,item_name,quantity,unit_price,selected_options) VALUES
 ('{ord1}','{menu}','existing meal',1,100,'[]'),('{ord2}','{menu}','existing meal',1,100,'[]');""")

items=f'''[{{"menu_item_id":"{menu}","item_name":"additional meal","quantity":1,"unit_price":100,"selected_options":[]}}]'''
def add(res, order, key):
    return f"SELECT public.add_reservation_order_items_once('{res}','{order}','{key}',repeat('a',64),'{items}'::jsonb);"
def settle(res):
    return f"SELECT public.settle_reservation_checkout('{res}',500,0,'cash',500,0,NULL,'synthetic','staff');"

# Add owns both locks; genuine settlement must block, see changed total and
# reject stale 500 (new due is 600), without a payment record or paid_at.
adding=start(f"SET application_name='actual_add'; BEGIN; {add(res1,ord1,'actual-add-key-00001')} SELECT pg_sleep(4); COMMIT;")
try:
    wait_for('actual_add', "wait_event='PgSleep'")
    settling=start(f"SET application_name='actual_wait_settle'; {settle(res1)}")
    wait_for('actual_wait_settle', "wait_event_type='Lock'")
    finish(adding)
    must_fail(settling,'amount_changed')
    assert run(f"SELECT total_amount::int || ':' || (paid_at IS NULL)::text FROM orders WHERE id='{ord1}'") == '200:true'
    assert run(f"SELECT count(*) FROM reservation_settlements WHERE reservation_id='{res1}'") == '0'
finally:
    if adding.poll() is None: adding.terminate()

# Genuine settlement owns both locks; after it commits, late add must reject
# and leave the one paid item and a single settlement record.
settling=start(f"SET application_name='actual_settle'; BEGIN; {settle(res2)} SELECT pg_sleep(4); COMMIT;")
try:
    wait_for('actual_settle', "wait_event='PgSleep'")
    adding=start(f"SET application_name='actual_wait_add'; {add(res2,ord2,'actual-add-key-00002')}")
    wait_for('actual_wait_add', "wait_event_type='Lock'")
    finish(settling)
    must_fail(adding,'order_cannot_add')
    assert run(f"SELECT total_amount::int || ':' || (paid_at IS NOT NULL)::text FROM orders WHERE id='{ord2}'") == '100:true'
    assert run(f"SELECT count(*) FROM reservation_settlements WHERE reservation_id='{res2}'") == '1'
    assert run(f"SELECT count(*) FROM order_items WHERE order_id='{ord2}'") == '1'
finally:
    if settling.poll() is None: settling.terminate()
print('Actual settlement RPC/guard/total triggers: both add-vs-settlement lock orders passed.')
