-- Reservation Preorder (additive, no payment or QR-order lifecycle coupling).
-- Apply only through the normal production migration approval path.

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS preorder_eligible boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS reservation_preorders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL UNIQUE REFERENCES reservations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'locked', 'cancelled')),
  requires_reconfirmation boolean NOT NULL DEFAULT false,
  guest_notes text,
  draft_items jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(draft_items) = 'array'),
  submit_idempotency_key text,
  submitted_at timestamptz,
  locked_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservation_preorders_status
  ON reservation_preorders(status);
CREATE INDEX IF NOT EXISTS idx_reservation_preorders_reconfirmation
  ON reservation_preorders(requires_reconfirmation)
  WHERE requires_reconfirmation = true;

CREATE TABLE IF NOT EXISTS reservation_preorder_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preorder_id uuid NOT NULL REFERENCES reservation_preorders(id) ON DELETE CASCADE,
  source_menu_item_id uuid REFERENCES menu_items(id) ON DELETE SET NULL,
  item_name_snapshot text NOT NULL,
  unit_price_snapshot numeric NOT NULL CHECK (unit_price_snapshot >= 0),
  quantity integer NOT NULL CHECK (quantity > 0 AND quantity <= 99),
  selected_options_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(selected_options_snapshot) = 'array'),
  special_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservation_preorder_items_preorder
  ON reservation_preorder_items(preorder_id);
CREATE INDEX IF NOT EXISTS idx_reservation_preorder_items_source_item
  ON reservation_preorder_items(source_menu_item_id);

CREATE OR REPLACE FUNCTION public.sync_reservation_preorder_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'rejected') THEN
    UPDATE reservation_preorders
       SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, now()), updated_at = now()
     WHERE reservation_id = NEW.id AND status <> 'cancelled';
  ELSIF NEW.status = 'completed' THEN
    UPDATE reservation_preorders
       SET status = CASE WHEN status = 'submitted' THEN 'locked' ELSE status END,
           locked_at = CASE WHEN status = 'submitted' THEN COALESCE(locked_at, now()) ELSE locked_at END,
           updated_at = now()
     WHERE reservation_id = NEW.id AND status <> 'cancelled';
  ELSIF OLD.start_time IS DISTINCT FROM NEW.start_time
     OR OLD.end_time IS DISTINCT FROM NEW.end_time
     OR OLD.room_id IS DISTINCT FROM NEW.room_id
     OR OLD.guest_count IS DISTINCT FROM NEW.guest_count THEN
    UPDATE reservation_preorders
       SET requires_reconfirmation = true, updated_at = now()
     WHERE reservation_id = NEW.id AND status IN ('draft', 'submitted', 'locked');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reservation_preorder_lifecycle ON reservations;
CREATE TRIGGER trg_reservation_preorder_lifecycle
  AFTER UPDATE OF status, start_time, end_time, room_id, guest_count ON reservations
  FOR EACH ROW EXECUTE FUNCTION public.sync_reservation_preorder_lifecycle();

REVOKE ALL ON FUNCTION public.sync_reservation_preorder_lifecycle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_reservation_preorder_lifecycle() TO service_role;

ALTER TABLE reservation_preorders ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_preorder_items ENABLE ROW LEVEL SECURITY;

-- Guest and staff APIs use the service role after their own authorization checks.
-- No anon/authenticated policy is intentionally created.

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
  IF v_reservation.status IN ('cancelled', 'completed') THEN
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
  IF now() >= v_reservation.start_time - interval '24 hours' THEN
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
    SELECT count(*)::integer INTO v_option_count
      FROM menu_item_options
     WHERE item_id = v_menu_item.id
       AND id IN (
         SELECT DISTINCT value::uuid
           FROM jsonb_array_elements_text(v_option_ids) AS option_values(value)
       );
    IF v_option_count <> v_distinct_option_count THEN
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

INSERT INTO schema_migrations (version, name)
VALUES ('20260921-reservation-preorder', 'migration-reservation-preorder.sql')
ON CONFLICT (version) DO NOTHING;
