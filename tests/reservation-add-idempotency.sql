-- Run against an isolated fixture database only. The caller creates the three
-- minimal tables and applies the migration before this file.
SET ROLE service_role;
DO $$
DECLARE
  result jsonb;
  items jsonb := '[{"menu_item_id":"00000000-0000-0000-0000-000000000003","item_name":"Coffee","quantity":1,"unit_price":100,"selected_options":[],"special_notes":null}]';
  other_items jsonb := '[{"menu_item_id":"00000000-0000-0000-0000-000000000003","item_name":null,"quantity":1,"unit_price":100,"selected_options":[],"special_notes":null}]';
BEGIN
  result := public.add_reservation_order_items_once('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'request-0000000000001', repeat('a',64), items);
  IF result->>'already_processed' <> 'false' THEN RAISE EXCEPTION 'first request not committed'; END IF;
  result := public.add_reservation_order_items_once('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'request-0000000000001', repeat('a',64), items);
  IF result->>'already_processed' <> 'true' OR (SELECT count(*) FROM public.order_items WHERE order_id='00000000-0000-0000-0000-000000000002') <> 1 OR (SELECT total_amount FROM public.orders WHERE id='00000000-0000-0000-0000-000000000002') <> 100 THEN RAISE EXCEPTION 'same-key replay duplicated order or total'; END IF;
  BEGIN
    PERFORM public.add_reservation_order_items_once('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'request-0000000000001', repeat('b',64), items);
    RAISE EXCEPTION 'key reuse unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'add_request_key_mismatch' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.add_reservation_order_items_once('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'request-0000000000002', repeat('b',64), other_items);
    RAISE EXCEPTION 'bad item unexpectedly accepted';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.reservation_order_add_requests WHERE request_key = 'request-0000000000002') THEN RAISE EXCEPTION 'ledger committed after failed items'; END IF;
  result := public.add_reservation_order_items_once('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'request-0000000000002', repeat('b',64), items);
  IF result->>'already_processed' <> 'false' OR (SELECT count(*) FROM public.order_items WHERE order_id='00000000-0000-0000-0000-000000000002') <> 2 OR (SELECT total_amount FROM public.orders WHERE id='00000000-0000-0000-0000-000000000002') <> 200 THEN RAISE EXCEPTION 'new intent or rollback recovery failed'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.add_reservation_order_items_once(uuid,uuid,text,text,jsonb)', 'execute')
     OR has_function_privilege('authenticated', 'public.add_reservation_order_items_once(uuid,uuid,text,text,jsonb)', 'execute') THEN
    RAISE EXCEPTION 'RPC executable by public role';
  END IF;
  IF has_table_privilege('anon','public.reservation_order_add_requests','select') THEN RAISE EXCEPTION 'ledger readable by anon'; END IF;
END $$;
-- A committed request must remain replayable even if the stay later ends.
UPDATE public.reservations SET status='completed' WHERE id='00000000-0000-0000-0000-000000000001';
UPDATE public.orders SET paid_at=now() WHERE id='00000000-0000-0000-0000-000000000002';
SET ROLE service_role;
DO $$
DECLARE result jsonb; items jsonb := '[{"menu_item_id":"00000000-0000-0000-0000-000000000003","item_name":"Coffee","quantity":1,"unit_price":100,"selected_options":[]}]';
BEGIN
  result := public.add_reservation_order_items_once('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','request-0000000000001',repeat('a',64),items);
  IF result->>'already_processed' <> 'true' THEN RAISE EXCEPTION 'committed replay rejected after checkout'; END IF;
  BEGIN
    PERFORM public.add_reservation_order_items_once('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','request-after-closed01',repeat('a',64),items);
    RAISE EXCEPTION 'new add accepted after checkout';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'order_cannot_add' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
-- If the status update fails after item insertion, neither the new item nor
-- its idempotency record may survive the transaction.
INSERT INTO public.reservations(id,status) VALUES ('00000000-0000-0000-0000-000000000006','checked_in');
INSERT INTO public.orders(id,reservation_id) VALUES ('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000006');
INSERT INTO public.order_items(order_id,menu_item_id,item_name,quantity,unit_price,served_at)
VALUES ('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000003','served item',1,100,now());
ALTER TABLE public.orders ADD CONSTRAINT fixture_no_preparing CHECK (status <> 'preparing');
SET ROLE service_role;
DO $$
BEGIN
  BEGIN
    PERFORM public.add_reservation_order_items_once('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000007','request-rollback-00001',repeat('d',64),'[{"menu_item_id":"00000000-0000-0000-0000-000000000003","item_name":"Tea","quantity":1,"unit_price":100,"selected_options":[]}]');
    RAISE EXCEPTION 'status failure unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.reservation_order_add_requests WHERE request_key='request-rollback-00001') THEN RAISE EXCEPTION 'ledger survived status failure'; END IF;
  IF (SELECT count(*) FROM public.order_items WHERE order_id='00000000-0000-0000-0000-000000000007') <> 1 THEN RAISE EXCEPTION 'insert survived status failure'; END IF;
END $$;
RESET ROLE;

-- Cancellation serializes against the add and produces a durable tombstone.
SET ROLE service_role;
DO $$
DECLARE result jsonb; items jsonb := '[{"menu_item_id":"00000000-0000-0000-0000-000000000003","item_name":"Tea","quantity":1,"unit_price":100,"selected_options":[]}]';
BEGIN
  result := public.cancel_reservation_order_add('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005','concurrent-key-00001');
  IF result->>'state' <> 'committed' THEN RAISE EXCEPTION 'committed add did not win'; END IF;
  result := public.cancel_reservation_order_add('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005','cancel-pending-key-001');
  IF result->>'state' <> 'canceled' THEN RAISE EXCEPTION 'cancel tombstone not created'; END IF;
  result := public.cancel_reservation_order_add('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005','cancel-pending-key-001');
  IF result->>'state' <> 'canceled' THEN RAISE EXCEPTION 'cancel replay changed result'; END IF;
  BEGIN
    PERFORM public.add_reservation_order_items_once('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005','cancel-pending-key-001',repeat('a',64),items);
    RAISE EXCEPTION 'canceled request unexpectedly committed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'add_request_canceled' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.cancel_reservation_order_add(uuid,uuid,text)', 'execute')
     OR has_function_privilege('authenticated', 'public.cancel_reservation_order_add(uuid,uuid,text)', 'execute') THEN
    RAISE EXCEPTION 'cancel RPC executable by public role';
  END IF;
END $$;
