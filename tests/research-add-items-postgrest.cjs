// Only executed inside the isolated, synthetic Docker network namespace.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createClient } = require('/fixture/node_modules/@supabase/supabase-js');
const secret = 'synthetic_secret_12345678901234567890';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function jwt(role) {
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role })}`;
  return `${unsigned}.${crypto.createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}
function client(role) {
  return createClient('http://127.0.0.1:3000', jwt(role), {
    global: { fetch: (url, options) => fetch(String(url).replace('/rest/v1', ''), options) },
  });
}
const admin = client('service_role');
const reservation = '00000000-0000-0000-0000-000000000001';
const order = '00000000-0000-0000-0000-000000000002';
const menu = '00000000-0000-0000-0000-000000000003';
const item = { menu_item_id: menu, item_name: 'Synthetic coffee', quantity: 1, unit_price: 100, selected_options: [], special_notes: null };
function args(key, hash = 'a'.repeat(64), items = [item]) {
  return { p_reservation_id: reservation, p_order_id: order, p_request_key: key, p_payload_hash: hash, p_items: items };
}
async function rpc(role, name, input) {
  return client(role).rpc(name, input);
}
async function itemCount() {
  const result = await admin.from('order_items').select('id', { count: 'exact', head: true }).eq('order_id', order);
  assert.equal(result.error, null);
  return result.count;
}

(async () => {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch('http://127.0.0.1:3000/')).status < 500) break; } catch {}
    if (i === 99) throw Error('PostgREST not ready');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  for (const role of ['anon', 'authenticated']) {
    const denied = await rpc(role, 'add_reservation_order_items_once', args('denied-request-00001'));
    assert.ok(denied.error, `${role} could execute add RPC`);
    const cancel = await rpc(role, 'cancel_reservation_order_add', {
      p_reservation_id: reservation, p_order_id: order, p_request_key: 'denied-request-00001',
    });
    assert.ok(cancel.error, `${role} could execute cancel RPC`);
    const ledger = await client(role).from('reservation_order_add_requests').select('state');
    assert.ok(ledger.error, `${role} could read the ledger`);
  }
  const first = await admin.rpc('add_reservation_order_items_once', args('repeat-request-00001'));
  assert.equal(first.error, null);
  assert.deepEqual(first.data, { committed: true, already_processed: false });
  // Simulate a client that did not retain the first response, then replays the key.
  const replay = await admin.rpc('add_reservation_order_items_once', args('repeat-request-00001'));
  assert.equal(replay.error, null);
  assert.deepEqual(replay.data, { committed: true, already_processed: true });
  assert.equal(await itemCount(), 1);
  const mismatch = await admin.rpc('add_reservation_order_items_once', args('repeat-request-00001', 'b'.repeat(64)));
  assert.ok(mismatch.error);
  assert.match(mismatch.error.message, /add_request_key_mismatch/);
  assert.equal(await itemCount(), 1);

  const simultaneous = await Promise.all([
    admin.rpc('add_reservation_order_items_once', args('concurrent-request-001')),
    admin.rpc('add_reservation_order_items_once', args('concurrent-request-001')),
  ]);
  assert.ok(simultaneous.every(result => result.error === null));
  assert.deepEqual(simultaneous.map(result => result.data.already_processed).sort(), [false, true]);
  assert.equal(await itemCount(), 2);

  const broken = await admin.rpc('add_reservation_order_items_once', args('rollback-request-0001', 'c'.repeat(64), [{ ...item, item_name: null }]));
  assert.ok(broken.error);
  assert.equal(await itemCount(), 2);
  const noLedger = await admin.from('reservation_order_add_requests').select('state').eq('reservation_id', reservation).eq('request_key', 'rollback-request-0001').maybeSingle();
  assert.equal(noLedger.error, null);
  assert.equal(noLedger.data, null);
  const retry = await admin.rpc('add_reservation_order_items_once', args('rollback-request-0001', 'c'.repeat(64)));
  assert.equal(retry.error, null);
  assert.equal(retry.data.already_processed, false);
  assert.equal(await itemCount(), 3);

  const cancelArgs = { p_reservation_id: reservation, p_order_id: order, p_request_key: 'cancel-request-000001' };
  const cancel = await admin.rpc('cancel_reservation_order_add', cancelArgs);
  assert.equal(cancel.error, null);
  assert.equal(cancel.data.state, 'canceled');
  const late = await admin.rpc('add_reservation_order_items_once', args(cancelArgs.p_request_key));
  assert.ok(late.error);
  assert.match(late.error.message, /add_request_canceled/);
  assert.equal(await itemCount(), 3);

  // Either the add commits first, or cancellation creates the tombstone first.
  // Both HTTP requests use independent PostgREST transactions; this does not
  // claim the requests always overlapped at the database lock.
  let expectedItems = 3;
  for (let i = 0; i < 10; i++) {
    const key = `cancel-race-request-${String(i).padStart(3, '0')}`;
    const input = { p_reservation_id: reservation, p_order_id: order, p_request_key: key };
    const add = () => admin.rpc('add_reservation_order_items_once', args(key));
    const cancelRace = () => admin.rpc('cancel_reservation_order_add', input);
    const pair = i % 2 ? [cancelRace(), add()] : [add(), cancelRace()];
    const results = await Promise.all(pair);
    const added = results[i % 2 ? 1 : 0];
    const canceled = results[i % 2 ? 0 : 1];
    assert.equal(canceled.error, null);
    if (canceled.data.state === 'committed') {
      assert.equal(added.error, null);
      assert.equal(added.data.committed, true);
      expectedItems++;
    } else {
      assert.equal(canceled.data.state, 'canceled');
      assert.ok(added.error);
      assert.match(added.error.message, /add_request_canceled/);
    }
    assert.equal(await itemCount(), expectedItems);
  }

  const closed = await admin.from('orders').update({ paid_at: '2026-01-01T00:00:00Z' }).eq('id', order);
  assert.equal(closed.error, null);
  const closedReplay = await admin.rpc('add_reservation_order_items_once', args('repeat-request-00001'));
  assert.equal(closedReplay.error, null);
  assert.equal(closedReplay.data.already_processed, true);
  const closedNew = await admin.rpc('add_reservation_order_items_once', args('closed-request-000001'));
  assert.ok(closedNew.error);
  assert.match(closedNew.error.message, /order_cannot_add/);
  assert.equal(await itemCount(), expectedItems);
  console.log('Synthetic Supabase client + PostgREST + PostgreSQL: role ACL, repeat, concurrency, rollback, cancellation and closed-order checks passed.');
})().catch(error => { console.error('Synthetic add-items fixture failed:', error); process.exit(1); });
