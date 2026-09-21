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
  v_item jsonb;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'preorder items must be an array' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_reservation
    FROM reservations
   WHERE id = p_reservation_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_reservation.status IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'reservation is not eligible for preorder' USING ERRCODE = 'P0001';
  END IF;
  IF now() >= v_reservation.start_time - interval '24 hours' THEN
    RAISE EXCEPTION 'preorder cutoff has passed' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_preorder
    FROM reservation_preorders
   WHERE reservation_id = p_reservation_id
   FOR UPDATE;
  IF FOUND AND v_preorder.status IN ('submitted', 'locked') THEN
    RETURN jsonb_build_object('id', v_preorder.id, 'status', v_preorder.status, 'already_submitted', true);
  END IF;

  IF v_preorder.id IS NULL THEN
    INSERT INTO reservation_preorders (
      reservation_id, status, guest_notes, draft_items,
      submit_idempotency_key, submitted_at, updated_at
    ) VALUES (
      p_reservation_id, 'submitted', p_guest_notes, p_items,
      p_idempotency_key, now(), now()
    ) RETURNING * INTO v_preorder;
  ELSE
    UPDATE reservation_preorders
       SET status = 'submitted',
           guest_notes = p_guest_notes,
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
    INSERT INTO reservation_preorder_items (
      preorder_id, source_menu_item_id, item_name_snapshot,
      unit_price_snapshot, quantity, selected_options_snapshot, special_notes
    ) VALUES (
      v_preorder.id,
      NULLIF(v_item->>'source_menu_item_id', '')::uuid,
      v_item->>'item_name_snapshot',
      (v_item->>'unit_price_snapshot')::numeric,
      (v_item->>'quantity')::integer,
      COALESCE(v_item->'selected_options_snapshot', '[]'::jsonb),
      NULLIF(v_item->>'special_notes', '')
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
