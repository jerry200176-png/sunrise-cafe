"""Exercise same-key concurrent RPCs against the throwaway Docker fixture."""
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

if sys.flags.optimize:
    raise SystemExit('Optimized Python is unsupported: checks must not be removed')

container_id = sys.argv[1]
query = """SELECT public.add_reservation_order_items_once(
'00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005',
'concurrent-key-00001',repeat('c',64),
'[{"menu_item_id":"00000000-0000-0000-0000-000000000003","item_name":"Tea","quantity":1,"unit_price":100,"selected_options":[]}]'::jsonb);"""

def call():
    completed = subprocess.run(['docker', 'exec', '-i', container_id, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], input=query, text=True, capture_output=True, check=True)
    return json.loads(completed.stdout)

with ThreadPoolExecutor(max_workers=2) as pool:
    results = list(pool.map(lambda _: call(), range(2)))
assert sorted(result['already_processed'] for result in results) == [False, True], results
count = subprocess.run(['docker', 'exec', container_id, 'psql', '-U', 'postgres', '-At', '-c', "SELECT count(*) FROM order_items WHERE order_id='00000000-0000-0000-0000-000000000005'"], text=True, capture_output=True, check=True).stdout.strip()
assert count == '1', count
