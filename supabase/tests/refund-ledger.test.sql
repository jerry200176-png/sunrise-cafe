-- 退款原則（Founder 2026-10-15）情境測試。跑法：scripts/test-settlement-sql.sh（拋棄式本機 PostgreSQL）。
-- 前置：settlement-fixture.sql → migration-reservation-settlements.sql 已套用在同一個全新資料庫。
-- 任何一條斷言失敗都會 RAISE EXCEPTION，psql 以 ON_ERROR_STOP 結束並回非 0。
\set ON_ERROR_STOP 1
SET client_min_messages = notice;

CREATE SCHEMA t;

CREATE FUNCTION t.ok(p_cond boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_label; END IF;
  RAISE NOTICE 'ok - %', p_label;
END $$;

CREATE FUNCTION t.raises(p_sql text, p_msg text, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE p_msg THEN RAISE EXCEPTION 'FAIL: % (expected "%", got "%")', p_label, p_msg, SQLERRM; END IF;
    RAISE NOTICE 'ok - %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % (expected error "%", but it succeeded)', p_label, p_msg;
END $$;

INSERT INTO branches (id, name) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'B1'), ('00000000-0000-0000-0000-0000000000b2', 'B2');

-- 每組一間新包廂（平日 200／hr），台北 2026-10-14（三）14:00–16:00，total_price 400 → 訂金 200
CREATE FUNCTION t.mk(p_status text DEFAULT 'checked_in', p_deposit_paid boolean DEFAULT true,
                     p_total numeric DEFAULT 400, p_deposit_status text DEFAULT 'paid', p_food numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_room uuid; v_res uuid;
BEGIN
  INSERT INTO rooms (branch_id, name, price_weekday, price_weekend)
  VALUES ('00000000-0000-0000-0000-0000000000b1', 'R', 200, 300) RETURNING id INTO v_room;
  INSERT INTO reservations (room_id, start_time, end_time, status, total_price, is_deposit_paid, deposit_status)
  VALUES (v_room, '2026-10-14 14:00+08', '2026-10-14 16:00+08', p_status, p_total, p_deposit_paid, p_deposit_status)
  RETURNING id INTO v_res;
  IF p_food IS NOT NULL THEN INSERT INTO orders (reservation_id, total_amount) VALUES (v_res, p_food); END IF;
  RETURN v_res;
END $$;

-- 常用身分（角色／分店清單一律由 API 從 session 帶入，這裡模擬）
CREATE FUNCTION t.b1() RETURNS uuid[] LANGUAGE sql AS $$ SELECT ARRAY['00000000-0000-0000-0000-0000000000b1'::uuid] $$;
CREATE FUNCTION t.b2() RETURNS uuid[] LANGUAGE sql AS $$ SELECT ARRAY['00000000-0000-0000-0000-0000000000b2'::uuid] $$;

CREATE FUNCTION t.refund(p_res uuid, p_amount integer, p_key text, p_method text DEFAULT 'transfer',
                         p_role text DEFAULT 'owner', p_branches uuid[] DEFAULT NULL, p_kind text DEFAULT 'deposit',
                         p_cap integer DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT request_reservation_refund(p_res, p_kind, p_amount, p_method, '客人取消', p_key, 'user-1', p_role, p_branches, p_cap)
$$;
CREATE FUNCTION t.mark(p_refund jsonb, p_status text, p_role text DEFAULT 'owner', p_branches uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT record_reservation_refund_status((p_refund->>'id')::uuid, p_status, NULL, NULL, 'user-1', p_role, p_branches)
$$;
CREATE FUNCTION t.settle(p_res uuid, p_before integer, p_refund integer DEFAULT 0, p_method text DEFAULT 'cash',
                         p_role text DEFAULT 'owner', p_branches uuid[] DEFAULT NULL, p_discount integer DEFAULT 0)
RETURNS reservation_settlements LANGUAGE sql AS $$
  SELECT * FROM settle_reservation_checkout(p_res, p_before, p_refund, p_method, p_before - p_discount, p_discount,
    CASE WHEN p_discount > 0 THEN '熟客' END, 'user-1', p_role, p_branches)
$$;

-- ===========================================================================
-- 原則 1：已退的訂金不能再折抵帳單（含重試、同時操作）
-- ===========================================================================
DO $$
DECLARE r uuid; f jsonb; s reservation_settlements;
BEGIN
  -- 1a 訂金全額退款成功 → 結帳不再折抵
  r := t.mk();
  f := t.refund(r, NULL, 'p1a');
  PERFORM t.ok((f->>'amount')::int = 200, 'P1a full deposit refund defaults to the refundable 200');
  PERFORM t.mark(f, 'succeeded');
  s := t.settle(r, 400);
  PERFORM t.ok(s.deposit_credit = 0 AND s.amount_due = 400, 'P1a refunded deposit is not credited at checkout');
  PERFORM t.ok((SELECT deposit_status FROM reservations WHERE id = r) = 'refunded', 'P1a full refund flips deposit_status to refunded');

  -- 1b 結帳重試：第二次失敗，退款帳本不會多記
  r := t.mk(p_total => 100);  -- 包廂費 100 − 訂金 50 → 收 50
  s := t.settle(r, 50);
  PERFORM t.raises(format('SELECT t.settle(%L, 50)', r), 'already_settled', 'P1b retried checkout is rejected');
  PERFORM t.ok((SELECT count(*) FROM reservation_settlements WHERE reservation_id = r) = 1, 'P1b exactly one settlement');

  -- 1c 結帳已折抵訂金 → 之後不能再退訂金
  r := t.mk();
  s := t.settle(r, 200);
  PERFORM t.ok(s.deposit_credit = 200, 'P1c checkout credits the deposit');
  PERFORM t.raises(format('SELECT t.refund(%L, NULL, %L)', r, 'p1c'), 'nothing_to_refund',
    'P1c a deposit already credited at checkout cannot be refunded');

  -- 1d 舊流程結帳（completed、沒有結帳紀錄）→ 訂金視為已折抵，不能退
  r := t.mk(p_status => 'completed');
  PERFORM t.raises(format('SELECT t.refund(%L, 50, %L)', r, 'p1d'), 'nothing_to_refund',
    'P1d legacy-completed stay cannot refund its deposit');

  -- 1e 舊資料 deposit_status = refunded（帳本沒有紀錄）→ 不折抵、也不能再退
  r := t.mk(p_deposit_status => 'refunded');
  PERFORM t.raises(format('SELECT t.refund(%L, 50, %L)', r, 'p1e'), 'nothing_to_refund',
    'P1e legacy refunded deposit cannot be refunded again');
  s := t.settle(r, 400);
  PERFORM t.ok(s.deposit_credit = 0, 'P1e legacy refunded deposit is not credited');

  -- 1f 結帳時退的差額（現金）不會再被當成可退訂金
  r := t.mk();
  -- 提早 90 分離開：包廂費 400 − 300 = 100，訂金 200 → 退 100
  PERFORM extend_reservation_stay(r, '2026-10-14 16:00+08', '2026-10-14 14:30+08', 'user-1');
  s := t.settle(r, 0, 100, 'cash');
  PERFORM t.ok(s.refund_amount = 100 AND s.deposit_credit = 200, 'P1f early leave owes 100 back');
  PERFORM t.raises(format('SELECT t.refund(%L, NULL, %L)', r, 'p1f'), 'nothing_to_refund',
    'P1f after the change is handed back, nothing of the deposit remains refundable');
  PERFORM t.raises(format('SELECT t.refund(%L, NULL, %L, %L, %L, NULL, %L)', r, 'p1f2', 'cash', 'owner', 'checkout_change'),
    'nothing_to_refund', 'P1f the checkout change cannot be refunded twice');
END $$;

-- ===========================================================================
-- 原則 2：只有老闆或本分店店長能退；SQL 自己再檢查一次
-- ===========================================================================
DO $$
DECLARE r uuid; f jsonb;
BEGIN
  r := t.mk(p_status => 'cancelled');
  PERFORM t.raises(format('SELECT t.refund(%L, 50, %L, %L, %L, %L)', r, 'p2-staff', 'transfer', 'staff', t.b1()),
    'refund_not_allowed', 'P2 staff cannot refund');
  PERFORM t.raises(format('SELECT t.refund(%L, 50, %L, %L, %L, %L)', r, 'p2-fin', 'transfer', 'finance', NULL),
    'refund_not_allowed', 'P2 finance cannot refund');
  PERFORM t.raises(format('SELECT t.refund(%L, 50, %L, %L, %L, NULL)', r, 'p2-null', 'transfer', NULL),
    'refund_not_allowed', 'P2 missing role cannot refund');
  PERFORM t.raises(format('SELECT t.refund(%L, 50, %L, %L, %L, %L)', r, 'p2-bm2', 'transfer', 'branch_manager', t.b2()),
    'refund_not_allowed', 'P2 manager of another branch cannot refund');
  PERFORM t.raises(format('SELECT t.refund(%L, 50, %L, %L, %L, NULL)', r, 'p2-bmall', 'transfer', 'branch_manager'),
    'refund_not_allowed', 'P2 manager without a branch list is not treated as all branches');
  PERFORM t.raises(format('SELECT t.refund(%L, 50, %L, %L, %L, %L)', r, 'p2-own2', 'transfer', 'owner', t.b2()),
    'refund_not_allowed', 'P2 owner restricted to another branch cannot refund');
  f := t.refund(r, 50, 'p2-bm1', 'transfer', 'branch_manager', t.b1());
  PERFORM t.ok(f->>'status' = 'requested', 'P2 own-branch manager can request a refund');
  PERFORM t.raises(format('SELECT t.mark(%L::jsonb, %L, %L, %L)', f, 'succeeded', 'staff', t.b1()),
    'refund_not_allowed', 'P2 staff cannot confirm a refund');
  PERFORM t.raises(format('SELECT t.mark(%L::jsonb, %L, %L, %L)', f, 'succeeded', 'branch_manager', t.b2()),
    'refund_not_allowed', 'P2 other-branch manager cannot confirm a refund');
  f := t.mark(f, 'succeeded', 'branch_manager', t.b1());
  PERFORM t.ok(f->>'status' = 'succeeded', 'P2 own-branch manager can confirm a refund');
  PERFORM t.ok(f->>'provider_ref' IS NULL, 'P2 manual refund has no provider reference');

  -- 結帳時的退款與打折也一樣檢查分店
  r := t.mk();
  PERFORM extend_reservation_stay(r, '2026-10-14 16:00+08', '2026-10-14 14:30+08', 'user-1');
  PERFORM t.raises(format('SELECT t.settle(%L, 0, 100, %L, %L, %L)', r, 'cash', 'branch_manager', t.b2()),
    'refund_not_allowed', 'P2 checkout refund by another branch manager is rejected');
  PERFORM t.raises(format('SELECT t.settle(%L, 0, 100, %L, %L, %L)', r, 'cash', 'staff', t.b1()),
    'refund_not_allowed', 'P2 checkout refund by staff is rejected');
  r := t.mk();
  PERFORM t.raises(format('SELECT t.settle(%L, 200, 0, %L, %L, %L, 20)', r, 'cash', 'branch_manager', t.b2()),
    'discount_not_allowed', 'P2 discount by another branch manager is rejected');
END $$;

-- anon／authenticated 什麼都碰不到；service_role 也不能改或刪帳本
GRANT USAGE ON SCHEMA t TO PUBLIC;
GRANT EXECUTE ON FUNCTION t.raises(text, text, text), t.ok(boolean, text) TO PUBLIC;
SET ROLE anon;
SELECT t.raises('SELECT count(*) FROM reservation_refunds', 'permission denied%', 'P2 anon cannot read the refund ledger');
SELECT t.raises('SELECT count(*) FROM reservation_refund_current', 'permission denied%', 'P2 anon cannot read the refund view');
SELECT t.raises($q$SELECT request_reservation_refund(gen_random_uuid(), 'deposit', 1, 'cash', 'x', 'k', 'a', 'owner', NULL)$q$,
  'permission denied%', 'P2 anon cannot call request_reservation_refund');
RESET ROLE;
SET ROLE authenticated;
SELECT t.raises($q$SELECT record_reservation_refund_status(gen_random_uuid(), 'succeeded', NULL, NULL, 'a', 'owner', NULL)$q$,
  'permission denied%', 'P2 authenticated cannot call record_reservation_refund_status');
RESET ROLE;

-- ===========================================================================
-- 原則 3：部分退款只扣實際退的金額
-- ===========================================================================
DO $$
DECLARE r uuid; f jsonb; s reservation_settlements;
BEGIN
  r := t.mk();
  f := t.refund(r, 80, 'p3-a');
  PERFORM t.mark(f, 'succeeded');
  PERFORM t.ok((SELECT deposit_status FROM reservations WHERE id = r) = 'paid', 'P3 partial refund keeps deposit_status paid');
  PERFORM t.ok(reservation_billing_state(r) @> '{"deposit_gross": 200, "deposit_refunded": 80, "deposit_refund_in_flight": false}',
    'P3 billing state shows only the 80 actually refunded');
  PERFORM t.raises(format('SELECT t.refund(%L, 121, %L)', r, 'p3-b'), 'refund_exceeds_refundable',
    'P3 cannot refund more than the 120 left');
  f := t.refund(r, 20, 'p3-c');
  PERFORM t.mark(f, 'succeeded');
  s := t.settle(r, 300);
  PERFORM t.ok(s.deposit_credit = 100, 'P3 checkout credits 200 − 80 − 20 = 100');
  -- 實收金額上限（API 從 Stripe 讀到的那筆付款剩多少沒退）：可退 = min(帳本上限, 實收上限)
  r := t.mk(p_status => 'cancelled');
  f := t.refund(r, NULL, 'p3-cap', 'stripe', 'owner', NULL, 'deposit', 150);
  PERFORM t.ok((f->>'amount')::int = 150, 'P3 refund is clamped to the captured amount still on the charge');
  PERFORM t.raises(format('SELECT t.refund(%L, 10, %L, %L, %L, NULL, %L, 0)', r, 'p3-cap2', 'stripe', 'owner', 'deposit'),
    'nothing_to_refund', 'P3 nothing refundable once the captured charge is used up');
END $$;

-- ===========================================================================
-- 原則 4：失敗或處理中的退款不能當成已退
-- ===========================================================================
DO $$
DECLARE r uuid; f jsonb; s reservation_settlements;
BEGIN
  -- 4a 處理中：不算已退、也不能拿訂金折抵 → 結帳擋下
  r := t.mk();
  f := t.refund(r, 200, 'p4-a');
  PERFORM t.ok(reservation_deposit_refunded(r) = 0, 'P4a requested refund counts as 0 refunded');
  PERFORM t.ok(reservation_billing_state(r) @> '{"deposit_refunded": 0, "deposit_refund_in_flight": true}',
    'P4a billing state reports the refund as in flight, not refunded');
  PERFORM t.raises(format('SELECT t.settle(%L, 200)', r), 'refund_in_flight', 'P4a checkout blocked while refund requested');
  f := t.mark(f, 'pending');
  PERFORM t.ok(reservation_deposit_refunded(r) = 0, 'P4a pending refund counts as 0 refunded');
  PERFORM t.ok((SELECT deposit_status FROM reservations WHERE id = r) = 'paid', 'P4a pending refund leaves deposit_status paid');
  PERFORM t.raises(format('SELECT t.settle(%L, 400)', r), 'refund_in_flight', 'P4a checkout blocked while refund pending');
  -- 4b 失敗 → 訂金照常折抵
  f := t.mark(f, 'failed');
  s := t.settle(r, 200);
  PERFORM t.ok(s.deposit_credit = 200, 'P4b failed refund leaves the full deposit creditable');

  -- 4c 成功後金流商回報失敗 → 回到未退、deposit_status 改回 paid
  r := t.mk();
  f := t.refund(r, 200, 'p4-c');
  PERFORM t.mark(f, 'succeeded');
  PERFORM t.ok((SELECT deposit_status FROM reservations WHERE id = r) = 'refunded', 'P4c succeeded → refunded');
  PERFORM t.mark(f, 'failed');
  PERFORM t.ok((SELECT deposit_status FROM reservations WHERE id = r) = 'paid', 'P4c succeeded → failed reverts to paid');
  PERFORM t.ok(reservation_deposit_refunded(r) = 0, 'P4c failed refund no longer counts');

  -- 4d 結帳差額：現金當場退 = succeeded；轉帳 = pending，要另外確認
  r := t.mk();
  PERFORM extend_reservation_stay(r, '2026-10-14 16:00+08', '2026-10-14 14:30+08', 'user-1');
  s := t.settle(r, 0, 100, 'transfer');
  PERFORM t.ok((SELECT status FROM reservation_refund_current WHERE settlement_id = s.id) = 'pending',
    'P4d non-cash checkout change starts pending');
  r := t.mk();
  PERFORM extend_reservation_stay(r, '2026-10-14 16:00+08', '2026-10-14 14:30+08', 'user-1');
  s := t.settle(r, 0, 100, 'cash');
  PERFORM t.ok((SELECT status FROM reservation_refund_current WHERE settlement_id = s.id) = 'succeeded',
    'P4d cash checkout change is succeeded');

  -- 4f（審閱 P1-a）Stripe 結果不明的請求：店長／老闆不能取消，結帳一直擋著，直到金流商或對帳給出結果
  r := t.mk();
  f := t.refund(r, 200, 'p4-f', 'stripe');
  PERFORM t.raises(format('SELECT t.mark(%L::jsonb, %L)', f, 'canceled'), 'provider_outcome_only',
    'P4f owner cannot cancel a Stripe refund whose outcome is unknown');
  PERFORM t.raises(format('SELECT t.mark(%L::jsonb, %L, %L, %L)', f, 'canceled', 'branch_manager', t.b1()), 'provider_outcome_only',
    'P4f manager cannot cancel a Stripe refund whose outcome is unknown');
  PERFORM t.raises(format('SELECT t.settle(%L, 200)', r), 'refund_in_flight', 'P4f checkout stays blocked until Stripe answers');
  -- Stripe 回報成功 → 算已退，結帳不再折抵
  PERFORM sync_provider_refund(r, (f->>'id')::uuid, 're_p4f', 200, 'succeeded');
  s := t.settle(r, 400);
  PERFORM t.ok(s.deposit_credit = 0, 'P4f a Stripe success after the uncertain window is never credited at checkout');
  -- 對帳確認 Stripe 沒有這筆退款 → provider 取消；之後若金流商仍回報成功，照算已退並留警示
  r := t.mk();
  f := t.refund(r, 200, 'p4-f2', 'stripe');
  PERFORM record_reservation_refund_status((f->>'id')::uuid, 'canceled', NULL, 'reconcile: no Stripe refund', 'reconcile', 'provider', NULL);
  s := t.settle(r, 200);
  PERFORM t.ok(s.deposit_credit = 200, 'P4f after reconcile confirms no refund, the deposit is credited');
  f := sync_provider_refund(r, (f->>'id')::uuid, 're_p4f2', 200, 'succeeded');
  PERFORM t.ok(f->>'status' = 'succeeded' AND (f->>'deposit_refunded')::int = 200, 'P4f a later provider success still counts');
  PERFORM t.ok(EXISTS (SELECT 1 FROM reservation_refund_alerts WHERE reservation_id = r AND kind = 'provider_succeeded_after_cancel'
    AND (detail->>'deposit_credit_at_checkout')::int = 200), 'P4f success-after-cancel raises a visible alert with the checkout credit');

  -- 4e Stripe 退款的結果只能由金流商回報
  r := t.mk(p_status => 'cancelled');
  f := t.refund(r, 200, 'p4-e', 'stripe');
  PERFORM t.raises(format('SELECT t.mark(%L::jsonb, %L)', f, 'succeeded'), 'provider_outcome_only',
    'P4e owner cannot mark a Stripe refund succeeded');
  f := sync_provider_refund(r, (f->>'id')::uuid, 're_1', 200, 'pending');
  PERFORM t.ok(f->>'status' = 'pending' AND (f->>'deposit_refunded')::int = 0, 'P4e Stripe pending is not refunded');
  f := sync_provider_refund(r, NULL, 're_1', 200, 'succeeded');
  PERFORM t.ok(f->>'status' = 'succeeded' AND (f->>'deposit_refunded')::int = 200, 'P4e Stripe succeeded found by provider ref');
END $$;

-- ===========================================================================
-- 原則 5：每筆退款都有持久紀錄，只能新增
-- ===========================================================================
DO $$
DECLARE r uuid; f jsonb; f2 jsonb; row reservation_refund_current%ROWTYPE;
BEGIN
  r := t.mk(p_status => 'cancelled');
  f := t.refund(r, 60, 'p5-key', 'transfer', 'branch_manager', t.b1());
  SELECT * INTO row FROM reservation_refund_current WHERE id = (f->>'id')::uuid;
  PERFORM t.ok(row.requested_by = 'user-1' AND row.requested_by_role = 'branch_manager' AND row.amount = 60
    AND row.reason = '客人取消' AND row.status = 'requested' AND row.reservation_id = r AND row.created_at IS NOT NULL
    AND row.branch_id = '00000000-0000-0000-0000-0000000000b1', 'P5 record has who, when, amount, reason, status, reservation');

  f2 := t.refund(r, 60, 'p5-key', 'transfer', 'branch_manager', t.b1());
  PERFORM t.ok(f2->>'id' = f->>'id', 'P5 same idempotency key returns the same refund');
  f2 := t.refund(r, NULL, 'p5-key', 'transfer', 'branch_manager', t.b1());
  PERFORM t.ok(f2->>'id' = f->>'id', 'P5 replay without amount returns the same refund');
  PERFORM t.raises(format('SELECT t.refund(%L, 70, %L)', r, 'p5-key'), 'idempotency_conflict',
    'P5 same key with a different amount is a conflict');
  PERFORM t.ok((SELECT count(*) FROM reservation_refunds WHERE reservation_id = r) = 1, 'P5 replays did not add rows');

  PERFORM t.mark(f, 'pending');
  PERFORM t.mark(f, 'pending');  -- 重送同一狀態：不多記
  PERFORM t.mark(f, 'succeeded');
  PERFORM t.ok((SELECT array_agg(status ORDER BY seq) FROM reservation_refund_events WHERE refund_id = (f->>'id')::uuid)
    = ARRAY['requested', 'pending', 'succeeded'], 'P5 history keeps every transition once');
  PERFORM t.raises(format('SELECT t.mark(%L::jsonb, %L)', f, 'pending'), 'invalid_refund_transition',
    'P5 succeeded cannot go back to pending');
  PERFORM t.raises(format('SELECT t.mark(%L::jsonb, %L)', f, 'requested'), 'invalid_refund_transition',
    'P5 cannot re-enter requested');

  PERFORM t.raises(format('UPDATE reservation_refunds SET amount = 1 WHERE id = %L', f->>'id'),
    'refund_ledger_append_only', 'P5 refunds cannot be updated');
  PERFORM t.raises(format('DELETE FROM reservation_refunds WHERE id = %L', f->>'id'),
    'refund_ledger_append_only', 'P5 refunds cannot be deleted');
  PERFORM t.raises(format('UPDATE reservation_refund_events SET status = %L WHERE refund_id = %L', 'failed', f->>'id'),
    'refund_ledger_append_only', 'P5 refund events cannot be updated');
  PERFORM t.raises(format('DELETE FROM reservation_refund_events WHERE refund_id = %L', f->>'id'),
    'refund_ledger_append_only', 'P5 refund events cannot be deleted');
  PERFORM t.raises('TRUNCATE reservation_refund_events', 'refund_ledger_append_only', 'P5 refund events cannot be truncated');
  PERFORM t.raises('TRUNCATE reservation_refunds CASCADE', 'refund_ledger_append_only', 'P5 refunds cannot be truncated');
  PERFORM t.raises(format('DELETE FROM reservations WHERE id = %L', r), '%violates foreign key%',
    'P5 a reservation with refunds cannot be deleted');

  -- Stripe 後台直接退：webhook 補記一筆，重送不會重複
  r := t.mk(p_status => 'cancelled');
  f := sync_provider_refund(r, NULL, 're_ext', 150, 'succeeded');
  f2 := sync_provider_refund(r, NULL, 're_ext', 150, 'succeeded');
  PERFORM t.ok(f->>'id' = f2->>'id' AND (SELECT count(*) FROM reservation_refunds WHERE reservation_id = r) = 1,
    'P5 provider refund recorded once');
  PERFORM t.ok((SELECT requested_by_role FROM reservation_refunds WHERE id = (f->>'id')::uuid) = 'provider',
    'P5 provider refund is marked as provider-originated');
  PERFORM t.ok(NOT EXISTS (SELECT 1 FROM reservation_refund_alerts WHERE reservation_id = r), 'P5 an in-cap dashboard refund raises no alert');
  -- 結帳已折抵訂金之後，才在 Stripe 後台退款 → 照實記，並留警示
  r := t.mk();
  PERFORM t.settle(r, 200);
  f := sync_provider_refund(r, NULL, 're_late', 200, 'succeeded');
  PERFORM t.ok(f->>'status' = 'succeeded', 'P5 a dashboard refund after checkout is still recorded');
  PERFORM t.ok(EXISTS (SELECT 1 FROM reservation_refund_alerts WHERE reservation_id = r AND kind = 'provider_after_checkout_credit'),
    'P5 a dashboard refund after checkout credit raises an alert');
  r := t.mk(p_status => 'cancelled');
  PERFORM sync_provider_refund(r, NULL, 're_big', 500, 'succeeded');
  PERFORM t.ok(EXISTS (SELECT 1 FROM reservation_refund_alerts WHERE reservation_id = r AND kind = 'provider_over_cap'),
    'P5 a dashboard refund above the cap raises an alert');
  PERFORM t.raises('UPDATE reservation_refund_alerts SET kind = kind', 'refund_ledger_append_only', 'P5 alerts cannot be edited');
  PERFORM t.raises(format('SELECT sync_provider_refund(%L, NULL, %L, 150, %L)', t.mk(), 're_ext', 'succeeded'),
    'refund_reservation_mismatch', 'P5 provider ref cannot be re-attached to another reservation');
END $$;

SET ROLE service_role;
SELECT t.raises('UPDATE reservation_refunds SET reason = reason', 'permission denied%', 'P5 service_role has no UPDATE on refunds');
SELECT t.raises('DELETE FROM reservation_refund_events', 'permission denied%', 'P5 service_role has no DELETE on refund events');
RESET ROLE;

SELECT t.ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c = 'search_path=public, pg_temp')),
  'every SECURITY DEFINER function pins search_path = public, pg_temp');

\echo 'refund-ledger.test.sql: ALL PASSED'
