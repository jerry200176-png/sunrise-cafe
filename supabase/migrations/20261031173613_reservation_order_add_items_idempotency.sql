-- Safe replay of a staff add-items request: one idempotency record and all
-- snapshot rows commit in the same transaction. Never stores card/payment data.
BEGIN;
CREATE TABLE IF NOT EXISTS public.reservation_order_add_requests (
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  request_key text NOT NULL CHECK (request_key ~ '^[a-zA-Z0-9_-]{16,128}$'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'committed' CHECK (state IN ('committed', 'canceled')),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reservation_id, request_key)
);

ALTER TABLE public.reservation_order_add_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reservation_order_add_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.reservation_order_add_requests TO service_role;

CREATE OR REPLACE FUNCTION public.add_reservation_order_items_once(
  p_reservation_id uuid,
  p_order_id uuid,
  p_request_key text,
  p_payload_hash text,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_status text;
  v_paid_at timestamptz;
  v_previous_hash text;
  v_previous_state text;
BEGIN
  IF p_request_key IS NULL OR p_request_key !~ '^[a-zA-Z0-9_-]{16,128}$'
     OR p_payload_hash IS NULL OR p_payload_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_add_request' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'invalid_add_items' USING ERRCODE = '22023';
  END IF;

  -- Same ordering as settlement: reservation first, then its order. Both
  -- original attempts and replays acquire the same locks before reading ledger.
  SELECT status INTO v_status FROM public.reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0001'; END IF;
  SELECT paid_at INTO v_paid_at FROM public.orders
    WHERE id = p_order_id AND reservation_id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001'; END IF;

  SELECT payload_hash, state INTO v_previous_hash, v_previous_state FROM public.reservation_order_add_requests
    WHERE reservation_id = p_reservation_id AND request_key = p_request_key;
  IF FOUND THEN
    IF v_previous_state = 'canceled' THEN
      RAISE EXCEPTION 'add_request_canceled' USING ERRCODE = 'P0001';
    END IF;
    IF v_previous_hash <> p_payload_hash THEN
      RAISE EXCEPTION 'add_request_key_mismatch' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object('committed', true, 'already_processed', true);
  END IF;

  IF v_status <> 'checked_in' OR v_paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'order_cannot_add' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.reservation_order_add_requests(reservation_id, request_key, payload_hash, order_id)
    VALUES (p_reservation_id, p_request_key, p_payload_hash, p_order_id);
  INSERT INTO public.order_items(order_id, menu_item_id, item_name, quantity, unit_price, selected_options, special_notes)
    SELECT p_order_id, (item->>'menu_item_id')::uuid, item->>'item_name', (item->>'quantity')::integer,
           (item->>'unit_price')::numeric, item->'selected_options', item->>'special_notes'
    FROM jsonb_array_elements(p_items) item;
  -- Existing triggers recalculate total_amount per row. Updating status here
  -- eliminates a stale post-insert status if the app loses its DB connection.
  UPDATE public.orders SET status = CASE
    WHEN EXISTS (SELECT 1 FROM public.order_items WHERE order_id = p_order_id AND served_at IS NOT NULL) THEN 'preparing'
    ELSE 'pending' END
  WHERE id = p_order_id;
  RETURN jsonb_build_object('committed', true, 'already_processed', false);
END;
$$;
REVOKE ALL ON FUNCTION public.add_reservation_order_items_once(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_reservation_order_items_once(uuid, uuid, text, text, jsonb) TO service_role;

-- Resolves unknown outcomes without retaining item payloads on the device.
-- The shared reservation/order locks serialize cancellation with original adds.
CREATE OR REPLACE FUNCTION public.cancel_reservation_order_add(
  p_reservation_id uuid, p_order_id uuid, p_request_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_state text;
BEGIN
  IF p_request_key IS NULL OR p_request_key !~ '^[a-zA-Z0-9_-]{16,128}$' THEN
    RAISE EXCEPTION 'invalid_add_request' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0001'; END IF;
  PERFORM 1 FROM public.orders WHERE id = p_order_id AND reservation_id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001'; END IF;
  SELECT state INTO v_state FROM public.reservation_order_add_requests
    WHERE reservation_id = p_reservation_id AND request_key = p_request_key;
  IF FOUND THEN RETURN jsonb_build_object('state', v_state); END IF;
  INSERT INTO public.reservation_order_add_requests(reservation_id, request_key, payload_hash, order_id, state)
    VALUES (p_reservation_id, p_request_key, repeat('0',64), p_order_id, 'canceled');
  RETURN jsonb_build_object('state','canceled');
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_reservation_order_add(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_reservation_order_add(uuid, uuid, text) TO service_role;

-- Reservation order status is derived inside the same transaction as every
-- item/paid_at change. The existing item guard locks orders before the change;
-- direct order UPDATE takes the same row lock before its BEFORE trigger.
-- It also neutralizes stale status values from older application instances.
CREATE OR REPLACE FUNCTION public.derive_reservation_order_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_any boolean; v_served boolean; v_unserved boolean;
BEGIN
  IF NEW.reservation_id IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) > 0, coalesce(bool_or(served_at IS NOT NULL), false),
         coalesce(bool_or(served_at IS NULL), false)
    INTO v_any, v_served, v_unserved
    FROM public.order_items WHERE order_id = NEW.id;
  NEW.status := CASE
    WHEN v_any AND NOT v_unserved THEN CASE WHEN NEW.paid_at IS NULL THEN 'ready' ELSE 'completed' END
    WHEN v_served THEN 'preparing'
    WHEN NEW.paid_at IS NOT NULL AND NOT v_any THEN 'completed'
    ELSE 'pending' END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.derive_reservation_order_status() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_derive_reservation_order_status BEFORE UPDATE OF status, paid_at ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.derive_reservation_order_status();

CREATE OR REPLACE FUNCTION public.refresh_reservation_order_status_after_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order_id uuid;
BEGIN
  v_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  UPDATE public.orders SET status = status WHERE id = v_order_id AND reservation_id IS NOT NULL;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_reservation_order_status_after_item() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_refresh_reservation_order_status_after_item AFTER INSERT OR UPDATE OR DELETE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.refresh_reservation_order_status_after_item();
COMMIT;
