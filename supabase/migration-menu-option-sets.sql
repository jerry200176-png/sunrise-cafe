-- 選項組（Menu option sets）：選項做一次、套用到多個餐點或整個分類。
--   必選一個 (min 1, max 1) / 可不選 (min 0, max 1) / 可多選 (min 0, max N 或不限)。
--
-- 設計：選項組是「範本」；每個餐點實際可選的項目仍是 menu_item_options 的列（由伺服器依選項組同步產生，
-- 帶 set_id / set_option_id）。所以既有的訂位預點、現場點餐、快照、列印都不用改讀法，選項 id 也保持穩定。
--
-- 本檔做的事（同一個交易）：
--  1. 新增 menu_option_sets / menu_option_set_options / menu_option_set_items / menu_option_set_categories。
--  2. menu_item_options 新增 nullable set_id / set_option_id。
--  3. assert_menu_item_option_selection()：資料庫端驗證「必選／上限／選項屬於該餐點」。
--  4. 重新定義 submit_reservation_preorder()：只把舊的「每組只能選一項」檢查換成上面的驗證（允許可多選、強制必選），其餘邏輯逐行不變。
--  5. 把既有「每個餐點各自的選項」依「分店 + 組名 + 選項名稱與加價完全相同」自動合併成選項組（行為不變：可不選、最多一項）。
--     預覽：npx tsx scripts/preview-option-set-merge.ts（唯讀，不寫入）。
-- 不刪除任何舊資料：menu_item_options 的列只是補上 set_id / set_option_id（id 不變）。
-- Rollback（還原程式碼之後）：
--   UPDATE menu_item_options SET set_id = NULL, set_option_id = NULL;
--   DROP TABLE menu_option_set_categories, menu_option_set_items, menu_option_set_options, menu_option_sets CASCADE;
--   ALTER TABLE menu_item_options DROP COLUMN set_option_id, DROP COLUMN set_id;
--   DROP FUNCTION public.assert_menu_item_option_selection(uuid, uuid[]);
--   -- 並用 migration-booking-meals.sql 內的 submit_reservation_preorder() 版本還原函式
--   DELETE FROM schema_migrations WHERE version = '20261009-menu-option-sets';
BEGIN;

CREATE TABLE IF NOT EXISTS menu_option_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  min_select integer NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select integer CHECK (max_select IS NULL OR max_select >= 1),
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_option_sets_min_le_max CHECK (max_select IS NULL OR min_select <= max_select)
);
CREATE INDEX IF NOT EXISTS idx_menu_option_sets_branch ON menu_option_sets(branch_id);

CREATE TABLE IF NOT EXISTS menu_option_set_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES menu_option_sets(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  price_delta numeric NOT NULL DEFAULT 0,
  display_order integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_menu_option_set_options_set ON menu_option_set_options(set_id);

CREATE TABLE IF NOT EXISTS menu_option_set_items (
  set_id uuid NOT NULL REFERENCES menu_option_sets(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  PRIMARY KEY (set_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_menu_option_set_items_item ON menu_option_set_items(item_id);

CREATE TABLE IF NOT EXISTS menu_option_set_categories (
  set_id uuid NOT NULL REFERENCES menu_option_sets(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (set_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_menu_option_set_categories_category ON menu_option_set_categories(category_id);

ALTER TABLE menu_item_options ADD COLUMN IF NOT EXISTS set_id uuid REFERENCES menu_option_sets(id) ON DELETE CASCADE;
ALTER TABLE menu_item_options ADD COLUMN IF NOT EXISTS set_option_id uuid REFERENCES menu_option_set_options(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_menu_item_options_item_set_option
  ON menu_item_options(item_id, set_option_id) WHERE set_option_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_menu_item_options_set ON menu_item_options(set_id);

ALTER TABLE menu_option_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_option_set_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_option_set_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_option_set_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_menu_option_sets" ON menu_option_sets;
DROP POLICY IF EXISTS "anon_read_menu_option_set_options" ON menu_option_set_options;
DROP POLICY IF EXISTS "service_all_menu_option_sets" ON menu_option_sets;
DROP POLICY IF EXISTS "service_all_menu_option_set_options" ON menu_option_set_options;
DROP POLICY IF EXISTS "service_all_menu_option_set_items" ON menu_option_set_items;
DROP POLICY IF EXISTS "service_all_menu_option_set_categories" ON menu_option_set_categories;
CREATE POLICY "anon_read_menu_option_sets" ON menu_option_sets FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_menu_option_set_options" ON menu_option_set_options FOR SELECT TO anon USING (true);
CREATE POLICY "service_all_menu_option_sets" ON menu_option_sets FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_menu_option_set_options" ON menu_option_set_options FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_menu_option_set_items" ON menu_option_set_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_menu_option_set_categories" ON menu_option_set_categories FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 資料庫端驗證：選項都屬於該餐點、不重複，且每組符合必選／上限。
-- 沒有 set_id 的舊列（無法自動合併的特例）視為「同組名最多一項、可不選」，和舊行為一致。
CREATE OR REPLACE FUNCTION public.assert_menu_item_option_selection(p_item_id uuid, p_option_ids uuid[])
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_ids uuid[] := COALESCE(p_option_ids, '{}'::uuid[]);
  v_group record;
BEGIN
  IF cardinality(v_ids) <> (SELECT count(DISTINCT x) FROM unnest(v_ids) AS x) THEN
    RAISE EXCEPTION 'preorder option is invalid' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM menu_item_options WHERE item_id = p_item_id AND id = ANY (v_ids)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'preorder option is invalid' USING ERRCODE = 'P0001';
  END IF;
  FOR v_group IN
    SELECT COALESCE(mo.set_id::text, 'g:' || mo.option_group) AS group_key,
           COALESCE(s.min_select, 0) AS min_select,
           CASE WHEN mo.set_id IS NULL THEN 1 ELSE s.max_select END AS max_select,
           count(*) FILTER (WHERE mo.id = ANY (v_ids)) AS picked
      FROM menu_item_options AS mo
      LEFT JOIN menu_option_sets AS s ON s.id = mo.set_id
     WHERE mo.item_id = p_item_id
     GROUP BY 1, 2, 3
  LOOP
    IF v_group.picked < v_group.min_select THEN
      RAISE EXCEPTION 'preorder option required' USING ERRCODE = 'P0001';
    END IF;
    IF v_group.max_select IS NOT NULL AND v_group.picked > v_group.max_select THEN
      RAISE EXCEPTION 'preorder option limit exceeded' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_menu_item_option_selection(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_menu_item_option_selection(uuid, uuid[]) TO service_role;

-- submit_reservation_preorder：與 migration-booking-meals.sql 相同，只把「每組只能選一項」的計數檢查換成上面的驗證。
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
    -- Required / optional / multi-select rules live in one place (選項組).
    PERFORM public.assert_menu_item_option_selection(
      v_menu_item.id,
      ARRAY(SELECT DISTINCT value::uuid FROM jsonb_array_elements_text(v_option_ids) AS option_values(value))
    );

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

-- 既有選項自動合併成選項組。
-- 合併規則（與 scripts/preview-option-set-merge.ts 相同）：同一分店、同組名、選項名稱＋加價完全相同 → 同一個選項組，
-- 套用到所有有這組選項的餐點。同組名但內容不同 → 另建「組名 (2)」…。同一餐點同組內選項名稱重複的特例不合併（保留原樣）。
DO $$
DECLARE
  v_row record;
  v_set_id uuid;
  v_order integer := 0;
BEGIN
  CREATE TEMP TABLE _legacy_option_groups ON COMMIT DROP AS
  SELECT mo.item_id, mi.branch_id, mo.option_group,
         md5(string_agg(mo.option_name || E'\u0001' || mo.price_delta::text, E'\u0002' ORDER BY mo.option_name, mo.price_delta)) AS sig
    FROM menu_item_options AS mo
    JOIN menu_items AS mi ON mi.id = mo.item_id
   WHERE mo.set_id IS NULL
   GROUP BY mo.item_id, mi.branch_id, mo.option_group
  HAVING count(*) = count(DISTINCT mo.option_name);

  FOR v_row IN
    SELECT branch_id, option_group, sig,
           count(*) AS item_count,
           (array_agg(item_id ORDER BY item_id::text))[1] AS rep_item,
           row_number() OVER (PARTITION BY branch_id, option_group ORDER BY count(*) DESC, sig) AS rn
      FROM _legacy_option_groups
     GROUP BY branch_id, option_group, sig
     ORDER BY branch_id, option_group, rn
  LOOP
    v_order := v_order + 1;
    INSERT INTO menu_option_sets (branch_id, name, min_select, max_select, display_order)
    VALUES (
      v_row.branch_id,
      left(CASE WHEN v_row.rn = 1 THEN v_row.option_group ELSE v_row.option_group || ' (' || v_row.rn || ')' END, 60),
      0, 1, v_order
    ) RETURNING id INTO v_set_id;

    INSERT INTO menu_option_set_options (set_id, name, price_delta, display_order)
    SELECT v_set_id, option_name, price_delta, display_order
      FROM menu_item_options
     WHERE item_id = v_row.rep_item AND option_group = v_row.option_group AND set_id IS NULL;

    INSERT INTO menu_option_set_items (set_id, item_id)
    SELECT v_set_id, item_id
      FROM _legacy_option_groups
     WHERE branch_id = v_row.branch_id AND option_group = v_row.option_group AND sig = v_row.sig;

    UPDATE menu_item_options AS mo
       SET set_id = v_set_id, set_option_id = so.id
      FROM _legacy_option_groups AS l, menu_option_set_options AS so
     WHERE l.branch_id = v_row.branch_id AND l.option_group = v_row.option_group AND l.sig = v_row.sig
       AND mo.item_id = l.item_id AND mo.option_group = v_row.option_group AND mo.set_id IS NULL
       AND so.set_id = v_set_id AND so.name = mo.option_name;
  END LOOP;
END;
$$;

INSERT INTO schema_migrations (version, name)
VALUES ('20261009-menu-option-sets', 'migration-menu-option-sets.sql')
ON CONFLICT (version) DO NOTHING;

COMMIT;
