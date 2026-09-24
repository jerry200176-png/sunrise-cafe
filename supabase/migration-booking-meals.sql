-- Booking meals: atomic booking, arrival activation, item service and settlement.
-- Apply after migration-reservation-preorder.sql through the approved migration workflow.
BEGIN;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS booking_request_key text UNIQUE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reservation_id uuid UNIQUE REFERENCES reservations(id) ON DELETE RESTRICT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS served_at timestamptz;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS source_preorder_item_id uuid UNIQUE REFERENCES reservation_preorder_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_reservation_id ON orders(reservation_id);

CREATE OR REPLACE FUNCTION public.guard_reservation_order_item_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_paid_at timestamptz;
  v_reservation_id uuid;
  v_order_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_order_id := OLD.order_id;
  ELSE v_order_id := NEW.order_id; END IF;
  SELECT reservation_id, paid_at INTO v_reservation_id, v_paid_at FROM orders WHERE id = v_order_id FOR UPDATE;
  IF v_reservation_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'INSERT' AND v_paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'settled order cannot receive new items' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' AND (v_paid_at IS NOT NULL OR OLD.served_at IS NOT NULL) THEN
    RAISE EXCEPTION 'settled or served item cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.served_at IS NOT NULL THEN RAISE EXCEPTION 'served item cannot be changed' USING ERRCODE = 'P0001'; END IF;
    IF v_paid_at IS NOT NULL AND (NEW.served_at IS NULL OR
      NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.unit_price IS DISTINCT FROM OLD.unit_price OR
      NEW.menu_item_id IS DISTINCT FROM OLD.menu_item_id OR NEW.selected_options IS DISTINCT FROM OLD.selected_options OR
      NEW.special_notes IS DISTINCT FROM OLD.special_notes) THEN
      RAISE EXCEPTION 'settled order cannot change items' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_reservation_order_item_change ON order_items;
CREATE TRIGGER trg_guard_reservation_order_item_change BEFORE INSERT OR UPDATE OR DELETE ON order_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_reservation_order_item_change();
REVOKE ALL ON FUNCTION public.guard_reservation_order_item_change() FROM PUBLIC, anon, authenticated;

-- Reservation-linked orders contain booking identity and stay service-role only.
DROP POLICY IF EXISTS "anon_read_orders" ON orders;
CREATE POLICY "anon_read_orders" ON orders FOR SELECT TO anon USING (reservation_id IS NULL);
DROP POLICY IF EXISTS "anon_read_order_items" ON order_items;
CREATE POLICY "anon_read_order_items" ON order_items FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND orders.reservation_id IS NULL));
DROP POLICY IF EXISTS "anon_insert_orders" ON orders;
CREATE POLICY "anon_insert_orders" ON orders FOR INSERT TO anon
  WITH CHECK (reservation_id IS NULL AND paid_at IS NULL);
DROP POLICY IF EXISTS "anon_insert_order_items" ON order_items;
CREATE POLICY "anon_insert_order_items" ON order_items FOR INSERT TO anon
  WITH CHECK (served_at IS NULL AND EXISTS (
    SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND orders.reservation_id IS NULL
  ));

-- The API computes the room price; the database owns the all-or-nothing insert.
CREATE OR REPLACE FUNCTION public.create_booking_with_meals(
  p_booking jsonb, p_items jsonb, p_guest_notes text, p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_reservation reservations%ROWTYPE;
BEGIN
  IF length(coalesce(p_idempotency_key, '')) < 16 OR length(p_idempotency_key) > 128 THEN
    RAISE EXCEPTION 'invalid booking idempotency key' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
  SELECT * INTO v_reservation FROM reservations WHERE booking_request_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_reservation.id, 'booking_code', v_reservation.booking_code, 'already_created', true);
  END IF;
  INSERT INTO reservations (
    room_id, customer_name, phone, email, start_time, end_time, status,
    total_price, guest_count, notes, line_user_id, booking_request_key
  ) VALUES (
    (p_booking->>'room_id')::uuid, p_booking->>'customer_name', p_booking->>'phone',
    p_booking->>'email', (p_booking->>'start_time')::timestamptz,
    (p_booking->>'end_time')::timestamptz, 'pending',
    (p_booking->>'total_price')::numeric, (p_booking->>'guest_count')::integer,
    p_booking->>'notes', p_booking->>'line_user_id', p_idempotency_key
  ) RETURNING * INTO v_reservation;
  PERFORM public.submit_reservation_preorder(
    v_reservation.id, p_guest_notes, p_items, p_idempotency_key
  );
  RETURN jsonb_build_object('id', v_reservation.id, 'booking_code', v_reservation.booking_code, 'already_created', false);
END;
$$;
REVOKE ALL ON FUNCTION public.create_booking_with_meals(jsonb,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_with_meals(jsonb,jsonb,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.activate_reservation_order(p_reservation_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_reservation reservations%ROWTYPE;
  v_preorder reservation_preorders%ROWTYPE;
  v_order_id uuid;
BEGIN
  SELECT * INTO v_reservation FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND OR v_reservation.status IN ('cancelled', 'completed', 'rejected') THEN
    RAISE EXCEPTION 'reservation cannot be checked in' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO v_order_id FROM orders WHERE reservation_id = p_reservation_id;
  IF FOUND THEN RETURN v_order_id; END IF;
  SELECT * INTO v_preorder FROM reservation_preorders WHERE reservation_id = p_reservation_id FOR UPDATE;
  IF v_preorder.requires_reconfirmation THEN
    RAISE EXCEPTION 'preorder requires staff review' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO orders (branch_id, reservation_id, status, total_amount, notes)
    SELECT branch_id, p_reservation_id, 'pending', 0, v_preorder.guest_notes
    FROM rooms WHERE id = v_reservation.room_id
    RETURNING id INTO v_order_id;
  IF v_preorder.id IS NOT NULL AND v_preorder.status IN ('submitted', 'locked') THEN
    INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, unit_price,
      selected_options, special_notes, source_preorder_item_id)
    SELECT v_order_id, source_menu_item_id, item_name_snapshot, quantity,
      unit_price_snapshot, selected_options_snapshot, special_notes, id
    FROM reservation_preorder_items WHERE preorder_id = v_preorder.id;
    UPDATE reservation_preorders SET status = 'locked', locked_at = now(), updated_at = now()
      WHERE id = v_preorder.id;
  END IF;
  UPDATE reservations SET status = 'checked_in' WHERE id = p_reservation_id;
  RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.activate_reservation_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_reservation_order(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.recalculate_reservation_order_total()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_order_id := OLD.order_id;
  ELSE v_order_id := NEW.order_id; END IF;
  UPDATE orders SET total_amount = (
    SELECT coalesce(sum(quantity * unit_price), 0) FROM order_items
    WHERE order_id = v_order_id
  ) WHERE id = v_order_id AND reservation_id IS NOT NULL;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_recalculate_reservation_order_total ON order_items;
CREATE TRIGGER trg_recalculate_reservation_order_total
  AFTER INSERT OR UPDATE OR DELETE ON order_items
  FOR EACH ROW EXECUTE FUNCTION public.recalculate_reservation_order_total();
REVOKE ALL ON FUNCTION public.recalculate_reservation_order_total() FROM PUBLIC, anon, authenticated;

-- Same-day reservations remain eligible until their reserved start time.
CREATE OR REPLACE FUNCTION public.submit_reservation_preorder(
  p_reservation_id uuid,
  p_guest_notes text,
  p_items jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation reservations%ROWTYPE;
  v_preorder reservation_preorders%ROWTYPE;
  v_branch_id uuid;
  v_menu_item menu_items%ROWTYPE;
  v_item jsonb;
  v_option_ids jsonb;
  v_selected_options jsonb;
  v_unit_price numeric;
  v_quantity integer;
  v_option_count integer;
  v_distinct_option_count integer;
  v_selected_group_count integer;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'preorder items must be an array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'too many preorder items' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_reservation
    FROM reservations
   WHERE id = p_reservation_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT branch_id INTO v_branch_id FROM rooms WHERE id = v_reservation.room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation room not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_reservation.status IN ('cancelled', 'completed', 'rejected', 'checked_in') THEN
    RAISE EXCEPTION 'reservation is not eligible for preorder' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_preorder
    FROM reservation_preorders
   WHERE reservation_id = p_reservation_id
   FOR UPDATE;
  IF FOUND AND v_preorder.status IN ('submitted', 'locked')
     AND NOT v_preorder.requires_reconfirmation THEN
    RETURN jsonb_build_object('id', v_preorder.id, 'status', v_preorder.status, 'already_submitted', true);
  END IF;
  IF now() >= v_reservation.start_time
     AND current_setting('booking_meals.staff_override', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'preorder cutoff has passed' USING ERRCODE = 'P0001';
  END IF;

  IF v_preorder.id IS NULL THEN
    INSERT INTO reservation_preorders (
      reservation_id, status, guest_notes, draft_items,
      submit_idempotency_key, submitted_at, updated_at
    ) VALUES (
      p_reservation_id, 'submitted', left(trim(p_guest_notes), 1000), p_items,
      p_idempotency_key, now(), now()
    ) RETURNING * INTO v_preorder;
  ELSE
    UPDATE reservation_preorders
       SET status = 'submitted',
           guest_notes = left(trim(p_guest_notes), 1000),
           draft_items = p_items,
           submit_idempotency_key = p_idempotency_key,
           submitted_at = COALESCE(submitted_at, now()),
           locked_at = NULL,
           cancelled_at = NULL,
           requires_reconfirmation = false,
           updated_at = now()
     WHERE id = v_preorder.id
     RETURNING * INTO v_preorder;
  END IF;

  DELETE FROM reservation_preorder_items WHERE preorder_id = v_preorder.id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_quantity := (v_item->>'quantity')::integer;
    IF v_quantity < 1 OR v_quantity > 99 THEN
      RAISE EXCEPTION 'invalid preorder quantity' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_menu_item
      FROM menu_items
     WHERE id = NULLIF(v_item->>'menu_item_id', '')::uuid
       AND branch_id = v_branch_id
       AND preorder_eligible = true
       AND is_available = true
     FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'preorder item is unavailable' USING ERRCODE = 'P0001';
    END IF;

    v_option_ids := COALESCE(v_item->'option_ids', '[]'::jsonb);
    IF jsonb_typeof(v_option_ids) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'preorder options must be an array' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(v_option_ids) > 30 THEN
      RAISE EXCEPTION 'too many preorder options' USING ERRCODE = '22023';
    END IF;
    SELECT count(DISTINCT value::uuid)::integer INTO v_distinct_option_count
      FROM jsonb_array_elements_text(v_option_ids) AS option_values(value);
    SELECT count(*)::integer, count(DISTINCT option_group)::integer
      INTO v_option_count, v_selected_group_count
      FROM menu_item_options
     WHERE item_id = v_menu_item.id
       AND id IN (
         SELECT DISTINCT value::uuid
           FROM jsonb_array_elements_text(v_option_ids) AS option_values(value)
       );
    IF v_option_count <> v_distinct_option_count OR v_option_count <> v_selected_group_count THEN
      RAISE EXCEPTION 'preorder option is invalid' USING ERRCODE = 'P0001';
    END IF;

    SELECT
      COALESCE(jsonb_agg(jsonb_build_object(
        'id', option_row.id,
        'group', option_row.option_group,
        'name', option_row.option_name,
        'delta', option_row.price_delta
      ) ORDER BY option_row.display_order, option_row.id), '[]'::jsonb),
      COALESCE(sum(option_row.price_delta), 0)
      INTO v_selected_options, v_unit_price
      FROM menu_item_options AS option_row
     WHERE option_row.item_id = v_menu_item.id
       AND option_row.id IN (
         SELECT DISTINCT value::uuid
           FROM jsonb_array_elements_text(v_option_ids) AS option_values(value)
       );

    INSERT INTO reservation_preorder_items (
      preorder_id, source_menu_item_id, item_name_snapshot,
      unit_price_snapshot, quantity, selected_options_snapshot, special_notes
    ) VALUES (
      v_preorder.id,
      v_menu_item.id,
      v_menu_item.name,
      v_menu_item.price + v_unit_price,
      v_quantity,
      v_selected_options,
      NULLIF(left(trim(v_item->>'special_notes'), 500), '')
    );
  END LOOP;

  RETURN jsonb_build_object('id', v_preorder.id, 'status', v_preorder.status, 'already_submitted', false);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_reservation_preorder(uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_reservation_preorder(uuid, text, jsonb, text) TO service_role;

-- Staff may replace the pre-arrival selection; the flag and replacement commit together.
CREATE OR REPLACE FUNCTION public.staff_replace_preorder(
  p_reservation_id uuid, p_items jsonb, p_guest_notes text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF v_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'reservation is already checked in or inactive' USING ERRCODE = 'P0001';
  END IF;
  UPDATE reservation_preorders SET requires_reconfirmation = true, updated_at = now()
    WHERE reservation_id = p_reservation_id;
  -- Staff may resolve a changed or same-day booking at the counter; guest cutoff stays enforced.
  PERFORM set_config('booking_meals.staff_override', 'on', true);
  RETURN public.submit_reservation_preorder(p_reservation_id, p_guest_notes, p_items, gen_random_uuid()::text);
END;
$$;
REVOKE ALL ON FUNCTION public.staff_replace_preorder(uuid,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_replace_preorder(uuid,jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.replace_menu_item_options(p_item_id uuid, p_options jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_option jsonb;
  v_index integer := 0;
BEGIN
  IF jsonb_typeof(p_options) IS DISTINCT FROM 'array' OR jsonb_array_length(p_options) > 50 THEN
    RAISE EXCEPTION 'invalid menu options' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM menu_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'menu item not found' USING ERRCODE = 'P0002'; END IF;
  DELETE FROM menu_item_options WHERE item_id = p_item_id;
  FOR v_option IN SELECT * FROM jsonb_array_elements(p_options) LOOP
    IF length(trim(coalesce(v_option->>'option_group', ''))) NOT BETWEEN 1 AND 60
      OR length(trim(coalesce(v_option->>'option_name', ''))) NOT BETWEEN 1 AND 100 THEN
      RAISE EXCEPTION 'invalid menu option name' USING ERRCODE = '22023';
    END IF;
    INSERT INTO menu_item_options (item_id, option_group, option_name, price_delta, display_order)
      VALUES (p_item_id, trim(v_option->>'option_group'), trim(v_option->>'option_name'),
        (v_option->>'price_delta')::numeric, v_index);
    v_index := v_index + 1;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.replace_menu_item_options(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_menu_item_options(uuid,jsonb) TO service_role;

INSERT INTO schema_migrations (version, name)
VALUES ('20260924-booking-meals', 'migration-booking-meals.sql')
ON CONFLICT (version) DO NOTHING;
COMMIT;
