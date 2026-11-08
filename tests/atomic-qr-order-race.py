"""Exercise the candidate with real repo schema and synthetic rows only."""
import json
import subprocess
import sys
import time

cid = sys.argv[1]
cmd = ['docker', 'exec', '-i', cid, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At']

def run(sql):
    return subprocess.run(cmd, input=sql, text=True, capture_output=True, check=True).stdout.strip()

def start(sql):
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    p.stdin.write(sql)
    p.stdin.close()
    return p

def wait_for(name, condition):
    for _ in range(100):
        if run(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{name}' AND {condition}") == '1': return
        time.sleep(.05)
    raise AssertionError(f'{name} not waiting: {condition}')

def result(p, error=None):
    rc = p.wait(timeout=10)
    stderr = p.stderr.read()
    if error: assert rc != 0 and error in stderr, (rc, stderr)
    else: assert rc == 0, stderr

b='30000000-0000-0000-0000-000000000001'
t='30000000-0000-0000-0000-000000000002'
m='30000000-0000-0000-0000-000000000003'
o='30000000-0000-0000-0000-000000000004'
token='fixture-qr-token'
run(f"""INSERT INTO branches(id,name) VALUES('{b}','synthetic');
INSERT INTO tables(id,branch_id,number,qr_token) VALUES('{t}','{b}','1','{token}');
INSERT INTO menu_items(id,branch_id,name,price,is_available) VALUES('{m}','{b}','synthetic',100,true);
INSERT INTO menu_item_options(id,item_id,option_group,option_name,price_delta) VALUES('{o}','{m}','size','large',25);""")
run("""GRANT SELECT, UPDATE ON branches,tables,menu_items,menu_item_options,menu_option_sets TO service_role;
GRANT SELECT, INSERT ON orders,order_items TO service_role;""")
items = json.dumps([{'menu_item_id':m,'item_name':'synthetic','quantity':2,'unit_price':125,'base_price':100,
  'option_ids':[o],'selected_options':[{'group':'size','name':'large','delta':25}],'special_notes':None}])
call = f"SELECT public.create_table_order_checked('{t}','{b}','{token}','{items}'::jsonb,NULL);"
assert run("SELECT has_function_privilege('anon','public.create_table_order_checked(uuid,uuid,text,jsonb,text)','execute')") == 'f'
assert run("SELECT has_function_privilege('authenticated','public.create_table_order_checked(uuid,uuid,text,jsonb,text)','execute')") == 'f'
run("SET ROLE service_role; " + call + " RESET ROLE;")
assert run("SELECT total_amount::int FROM orders") == '250'
assert run("SELECT unit_price::int FROM order_items") == '125'

# Price update owns item lock first: transaction must see changed price, reject,
# and leave both order tables untouched.
updating = start(f"SET application_name='qr_price_update'; BEGIN; UPDATE menu_items SET price=150 WHERE id='{m}'; SELECT pg_sleep(4); COMMIT;")
try:
    wait_for('qr_price_update', "wait_event='PgSleep'")
    ordering = start("SET application_name='qr_wait_order'; " + call)
    wait_for('qr_wait_order', "wait_event_type='Lock'")
    result(updating)
    result(ordering, 'qr_catalog_changed')
    assert run('SELECT count(*) FROM orders') == '1'
finally:
    if updating.poll() is None: updating.terminate()

# Order owns item lock first: concurrent price update waits until the transaction
# commits, and the order snapshots exactly the previously displayed price.
run(f"UPDATE menu_items SET price=100 WHERE id='{m}';")
ordering = start("SET application_name='qr_order'; BEGIN; " + call + " SELECT pg_sleep(4); COMMIT;")
try:
    wait_for('qr_order', "wait_event='PgSleep'")
    updating = start(f"SET application_name='qr_wait_price'; UPDATE menu_items SET price=150 WHERE id='{m}';")
    wait_for('qr_wait_price', "wait_event_type='Lock'")
    result(ordering); result(updating)
    assert run('SELECT count(*) FROM orders WHERE total_amount=250') == '2'
finally:
    if ordering.poll() is None: ordering.terminate()

# If an option surcharge changed after the API snapshot, final insertion fails.
run(f"UPDATE menu_items SET price=100 WHERE id='{m}'; UPDATE menu_item_options SET price_delta=30 WHERE id='{o}';")
p = start(call); result(p, 'qr_catalog_changed')
assert run('SELECT count(*) FROM orders') == '2'
run(f"UPDATE menu_item_options SET price_delta=25 WHERE id='{o}';")

# An archive already in progress must win before final insertion.
run(f"UPDATE menu_items SET price=100 WHERE id='{m}';")
archiving = start(f"SET application_name='qr_archive'; BEGIN; UPDATE branches SET archived_at=now() WHERE id='{b}'; SELECT pg_sleep(4); COMMIT;")
try:
    wait_for('qr_archive', "wait_event='PgSleep'")
    ordering = start("SET application_name='qr_wait_archive'; " + call)
    wait_for('qr_wait_archive', "wait_event_type='Lock'")
    result(archiving); result(ordering, 'qr_branch_unavailable')
    assert run('SELECT count(*) FROM orders') == '2'
finally:
    if archiving.poll() is None: archiving.terminate()

# An item insert failure rolls the order header back too.
run(f"UPDATE branches SET archived_at=NULL WHERE id='{b}'; CREATE FUNCTION public.fixture_fail_qr_item() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced_item_failure'; END $$; CREATE TRIGGER fixture_fail_qr_item BEFORE INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION public.fixture_fail_qr_item();")
p = start(call); result(p, 'forced_item_failure')
assert run('SELECT count(*) FROM orders') == '2'
assert run('SELECT count(*) FROM order_items') == '2'
run(f"DROP TRIGGER fixture_fail_qr_item ON order_items; UPDATE tables SET is_active=false WHERE id='{t}';")
p = start(call); result(p, 'qr_table_unavailable')
assert run('SELECT count(*) FROM orders') == '2'

# PostgreSQL numeric remains authoritative even if JS's intermediate sum is
# 0.30000000000000004; no currency rounding policy is introduced.
run(f"UPDATE tables SET is_active=true WHERE id='{t}'; UPDATE menu_items SET price=0.1 WHERE id='{m}'; UPDATE menu_item_options SET price_delta=0.2 WHERE id='{o}';")
decimal_items = json.dumps([{'menu_item_id':m,'item_name':'synthetic','quantity':1,'unit_price':0.1+0.2,'base_price':0.1,
  'option_ids':[o],'selected_options':[{'group':'size','name':'large','delta':0.2}],'special_notes':None}])
order_id = run(f"SELECT public.create_table_order_checked('{t}','{b}','{token}','{decimal_items}'::jsonb,NULL);")
assert run(f"SELECT total_amount::text FROM orders WHERE id='{order_id}'") == '0.3'
assert run(f"SELECT unit_price::text FROM order_items WHERE order_id='{order_id}'") == '0.3'

# Token rotation commits first: a request authorized by the old token must
# wait for the table row and then reject without creating any new order.
run(f"UPDATE menu_items SET price=100 WHERE id='{m}'; UPDATE menu_item_options SET price_delta=25 WHERE id='{o}';")
rotate = start(f"SET application_name='qr_rotate'; BEGIN; UPDATE tables SET qr_token='replacement-token' WHERE id='{t}'; SELECT pg_sleep(4); COMMIT;")
try:
    wait_for('qr_rotate', "wait_event='PgSleep'")
    ordering = start("SET application_name='qr_wait_rotation'; " + call)
    wait_for('qr_wait_rotation', "wait_event_type='Lock'")
    result(rotate); result(ordering, 'qr_table_unavailable')
    assert run('SELECT count(*) FROM orders') == '3'
finally:
    if rotate.poll() is None: rotate.terminate()

# An order transaction that owns the table lock first may complete; rotation
# waits, and subsequent attempts with the old token are rejected.
run(f"UPDATE tables SET qr_token='{token}' WHERE id='{t}';")
ordering = start("SET application_name='qr_token_order'; BEGIN; " + call + " SELECT pg_sleep(4); COMMIT;")
try:
    wait_for('qr_token_order', "wait_event='PgSleep'")
    rotate = start(f"SET application_name='qr_wait_token'; UPDATE tables SET qr_token='replacement-token' WHERE id='{t}';")
    wait_for('qr_wait_token', "wait_event_type='Lock'")
    result(ordering); result(rotate)
    p = start(call); result(p, 'qr_table_unavailable')
    assert run('SELECT count(*) FROM orders') == '4'
finally:
    if ordering.poll() is None: ordering.terminate()
print('Actual QR schema: pricing/archive races, atomic rollback and anon ACL passed.')
