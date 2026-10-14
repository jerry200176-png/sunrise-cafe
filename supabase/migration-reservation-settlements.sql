-- #444 結帳紀錄：原子結帳、延長紀錄、收款資訊、no_show 釋出時段。
--
-- ⚠️ 草稿，等 Founder 看過這份 SQL 並核准確切內容後才能套用到正式環境。
--    審閱說明：docs/plans/2026-10-14-reservation-settlements.md
--
-- 只新增表、函式和換一條 constraint，不改、不刪任何既有資料列。
-- 套用前檢查（兩個都應該是 0 列；第 2 個不是 0 列也能套，只代表有舊的沒來紀錄會釋出時段）：
--   1) SELECT count(*) FROM reservations WHERE status NOT IN
--        ('pending','confirmed','checked_in','cancelled','completed','no_show');
--   2) SELECT count(*) FROM reservations WHERE status = 'no_show';
-- 回滾：見本檔最下方。

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. 延長／縮短紀錄：每次改結束時間一列，費率在當下就固定下來，之後房價改了也不影響
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservation_extensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  from_end timestamptz NOT NULL,
  to_end timestamptz NOT NULL,
  -- 正數 = 延長、負數 = 提早離開
  minutes integer NOT NULL,
  hourly_rate numeric NOT NULL CHECK (hourly_rate >= 0),
  -- 這次延長／縮短的包廂費差額（整數元，可為負）
  fee integer NOT NULL,
  actor text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (to_end <> from_end),
  CHECK (minutes * 60 = extract(epoch FROM (to_end - from_end))::integer)
);

CREATE INDEX IF NOT EXISTS idx_reservation_extensions_reservation
  ON reservation_extensions(reservation_id, created_at);

-- ---------------------------------------------------------------------------
-- 2. 結帳紀錄：每筆訂位最多一列（unique），金額全部在結帳當下寫死
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservation_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL UNIQUE REFERENCES reservations(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES orders(id) ON DELETE RESTRICT,
  -- full = 在包廂裡的客人結帳離場；food_only = 已完成／取消／沒來的組只補收餐費
  kind text NOT NULL CHECK (kind IN ('full', 'food_only')),
  booked_room_fee integer NOT NULL DEFAULT 0,
  extension_fee integer NOT NULL DEFAULT 0,
  room_fee integer NOT NULL CHECK (room_fee >= 0),
  food_total integer NOT NULL CHECK (food_total >= 0),
  -- 餐費之前已用舊流程記過已收，這次不再收
  food_already_paid boolean NOT NULL DEFAULT false,
  deposit_credit integer NOT NULL CHECK (deposit_credit >= 0),
  amount_before_discount integer NOT NULL CHECK (amount_before_discount >= 0),
  discount_amount integer NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  discount_reason text,
  discount_by_role text,
  amount_due integer NOT NULL CHECK (amount_due >= 0),
  refund_amount integer NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  amount_collected integer NOT NULL CHECK (amount_collected >= 0),
  payment_method text NOT NULL
    CHECK (payment_method IN ('cash', 'card', 'line_pay', 'transfer', 'other', 'none')),
  settled_by text,
  settled_by_role text,
  settled_at timestamptz NOT NULL DEFAULT now(),
  CHECK (room_fee = GREATEST(0, booked_room_fee + extension_fee) OR kind = 'food_only'),
  CHECK (kind = 'full' OR (room_fee = 0 AND deposit_credit = 0 AND extension_fee = 0)),
  CHECK (amount_due = amount_before_discount - discount_amount),
  CHECK (amount_collected = amount_due),
  -- 有收錢或有退錢就要記方式；沒有金流才是 none
  CHECK ((amount_due = 0 AND refund_amount = 0) = (payment_method = 'none')),
  CHECK (refund_amount = 0 OR amount_before_discount = 0),
  CHECK (
    discount_amount = 0
    OR (discount_reason IS NOT NULL AND length(btrim(discount_reason)) > 0
        AND discount_by_role IN ('owner', 'branch_manager'))
  )
);

CREATE INDEX IF NOT EXISTS idx_reservation_settlements_settled_at
  ON reservation_settlements(settled_at);

ALTER TABLE reservation_extensions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_reservation_extensions" ON reservation_extensions;
CREATE POLICY "service_all_reservation_extensions" ON reservation_extensions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE reservation_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_reservation_settlements" ON reservation_settlements;
CREATE POLICY "service_all_reservation_settlements" ON reservation_settlements
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 共用：與 src/lib/room-checkout.ts 相同的規則
--   * 平日／假日依「台北日期」判斷（週六、週日 = 假日）
--   * 四捨五入用 floor(x + 0.5)，和 JS Math.round 一致（負數也一樣）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reservation_hourly_rate(p_room_id uuid, p_start timestamptz)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    CASE WHEN extract(isodow FROM (p_start AT TIME ZONE 'Asia/Taipei')) IN (6, 7)
      THEN r.price_weekend ELSE r.price_weekday END,
    0)
  FROM rooms r
  WHERE r.id = p_room_id
$$;

-- ---------------------------------------------------------------------------
-- 3. 延長／縮短：鎖住訂位 → 核對剛讀到的結束時間 → 改時間 → 記一筆延長紀錄（同一個 transaction）
--    撞到下一組時，exclusion constraint 會丟 23P01，原樣往上拋給 API 處理。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.extend_reservation_stay(
  p_reservation_id uuid,
  p_expected_end timestamptz,
  p_new_end timestamptz,
  p_actor text DEFAULT NULL
) RETURNS reservation_extensions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res reservations%ROWTYPE;
  v_rate numeric;
  v_minutes integer;
  v_row reservation_extensions%ROWTYPE;
BEGIN
  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_res.status <> 'checked_in' THEN
    RAISE EXCEPTION 'not_checked_in' USING ERRCODE = 'P0001';
  END IF;
  IF v_res.end_time <> p_expected_end THEN
    RAISE EXCEPTION 'stale_end_time' USING ERRCODE = 'P0001';
  END IF;
  IF p_new_end <= v_res.start_time THEN
    RAISE EXCEPTION 'end_before_start' USING ERRCODE = 'P0001';
  END IF;
  IF p_new_end = v_res.end_time THEN
    RAISE EXCEPTION 'no_change' USING ERRCODE = 'P0001';
  END IF;
  IF extract(epoch FROM (p_new_end - v_res.end_time)) % 60 <> 0 THEN
    RAISE EXCEPTION 'not_whole_minutes' USING ERRCODE = 'P0001';
  END IF;

  v_rate := reservation_hourly_rate(v_res.room_id, v_res.start_time);
  v_minutes := (extract(epoch FROM (p_new_end - v_res.end_time)) / 60)::integer;

  UPDATE reservations SET end_time = p_new_end WHERE id = v_res.id;

  INSERT INTO reservation_extensions (reservation_id, from_end, to_end, minutes, hourly_rate, fee, actor)
  VALUES (v_res.id, v_res.end_time, p_new_end, v_minutes, v_rate,
          floor(v_rate * v_minutes / 60.0 + 0.5)::integer, p_actor)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. 原子結帳：鎖住訂位與點餐單 → 伺服器重算金額並和店員看到的核對 → 寫結帳紀錄
--    → 記餐點已收 → 在包廂裡的組轉成 completed。全部成功或全部不做。
--    兩台同時結帳：後到的會等前一台的 transaction，接著因 already_settled（或 unique）失敗。
--    同時取消／延長：都要先拿同一列訂位的 FOR UPDATE 鎖，所以一定是先後發生、不會交錯。
--    LINE 評價邀請、鎖預點單這類附帶動作仍由 API 在 RPC 成功後執行（失敗不影響已結帳）。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_reservation_checkout(
  p_reservation_id uuid,
  p_expected_before_discount integer,
  p_expected_refund integer,
  p_payment_method text,
  p_amount_collected integer,
  p_discount_amount integer DEFAULT 0,
  p_discount_reason text DEFAULT NULL,
  p_actor text DEFAULT NULL,
  p_actor_role text DEFAULT NULL
) RETURNS reservation_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res reservations%ROWTYPE;
  v_order orders%ROWTYPE;
  v_has_order boolean := false;
  v_kind text;
  v_rate numeric;
  v_ext_minutes integer := 0;
  v_ext_fee integer := 0;
  v_booked integer := 0;
  v_room integer := 0;
  v_food integer := 0;
  v_food_paid boolean := false;
  v_deposit integer := 0;
  v_gross integer;
  v_before integer;
  v_refund integer;
  v_discount integer := COALESCE(p_discount_amount, 0);
  v_due integer;
  v_row reservation_settlements%ROWTYPE;
BEGIN
  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM reservation_settlements WHERE reservation_id = v_res.id) THEN
    RAISE EXCEPTION 'already_settled' USING ERRCODE = 'P0001';
  END IF;
  IF v_res.status IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'not_arrived' USING ERRCODE = 'P0001';
  END IF;
  v_kind := CASE WHEN v_res.status = 'checked_in' THEN 'full' ELSE 'food_only' END;

  -- 點餐單一起鎖住：order_items 的 guard trigger 也會鎖這一列，所以結帳期間沒人能加點
  SELECT * INTO v_order FROM orders WHERE reservation_id = v_res.id FOR UPDATE;
  v_has_order := FOUND;
  IF v_has_order THEN
    v_food := floor(COALESCE(v_order.total_amount, 0) + 0.5)::integer;
    v_food_paid := v_order.paid_at IS NOT NULL;
  END IF;

  IF v_kind = 'food_only' AND (NOT v_has_order OR v_food_paid OR v_food <= 0) THEN
    RAISE EXCEPTION 'nothing_to_settle' USING ERRCODE = 'P0001';
  END IF;

  IF v_kind = 'full' THEN
    v_rate := reservation_hourly_rate(v_res.room_id, v_res.start_time);
    SELECT COALESCE(sum(minutes), 0), COALESCE(sum(fee), 0)
      INTO v_ext_minutes, v_ext_fee
      FROM reservation_extensions WHERE reservation_id = v_res.id;
    -- 預約時段照訂位當時的 total_price；舊資料沒有 total_price 才用目前房價算原訂時數
    v_booked := COALESCE(
      floor(v_res.total_price + 0.5)::integer,
      floor(v_rate * (extract(epoch FROM (v_res.end_time - v_res.start_time)) / 60 - v_ext_minutes) / 60.0 + 0.5)::integer
    );
    v_room := GREATEST(0, v_booked + v_ext_fee);
    -- 訂金 = 訂位總價的一半（無條件進位），和 getDepositAmount 一致；延長不影響訂金基礎
    IF v_res.is_deposit_paid AND COALESCE(v_res.total_price, v_room) > 0 THEN
      v_deposit := ceil(COALESCE(v_res.total_price, v_room) * 0.5)::integer;
    END IF;
  END IF;

  v_gross := v_room + CASE WHEN v_food_paid THEN 0 ELSE v_food END - v_deposit;
  v_before := GREATEST(0, v_gross);
  v_refund := GREATEST(0, -v_gross);

  -- 店員確認的金額必須等於伺服器現在算出的金額（別台剛加點或延長就擋下）
  IF p_expected_before_discount IS DISTINCT FROM v_before
     OR COALESCE(p_expected_refund, 0) <> v_refund THEN
    RAISE EXCEPTION 'amount_changed' USING ERRCODE = 'P0001',
      DETAIL = json_build_object('amount_before_discount', v_before, 'refund', v_refund)::text;
  END IF;

  IF v_discount < 0 THEN
    RAISE EXCEPTION 'invalid_discount' USING ERRCODE = 'P0001';
  END IF;
  IF v_discount > 0 THEN
    IF p_actor_role IS NULL OR p_actor_role NOT IN ('owner', 'branch_manager') THEN
      RAISE EXCEPTION 'discount_not_allowed' USING ERRCODE = 'P0001';
    END IF;
    IF p_discount_reason IS NULL OR length(btrim(p_discount_reason)) = 0 THEN
      RAISE EXCEPTION 'discount_reason_required' USING ERRCODE = 'P0001';
    END IF;
    IF v_discount > v_before THEN
      RAISE EXCEPTION 'discount_too_large' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  v_due := v_before - v_discount;

  IF p_amount_collected IS DISTINCT FROM v_due THEN
    RAISE EXCEPTION 'collected_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF (v_due > 0 OR v_refund > 0) AND COALESCE(p_payment_method, 'none') = 'none' THEN
    RAISE EXCEPTION 'payment_method_required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO reservation_settlements (
    reservation_id, order_id, kind, booked_room_fee, extension_fee, room_fee,
    food_total, food_already_paid, deposit_credit, amount_before_discount,
    discount_amount, discount_reason, discount_by_role, amount_due, refund_amount,
    amount_collected, payment_method, settled_by, settled_by_role
  ) VALUES (
    v_res.id, CASE WHEN v_has_order THEN v_order.id END, v_kind, v_booked, v_ext_fee, v_room,
    v_food, v_food_paid, v_deposit, v_before,
    v_discount, NULLIF(btrim(p_discount_reason), ''), CASE WHEN v_discount > 0 THEN p_actor_role END,
    v_due, v_refund, p_amount_collected,
    CASE WHEN v_due = 0 AND v_refund = 0 THEN 'none' ELSE p_payment_method END,
    p_actor, p_actor_role
  ) RETURNING * INTO v_row;

  IF v_has_order AND v_order.paid_at IS NULL THEN
    UPDATE orders SET paid_at = v_row.settled_at WHERE id = v_order.id;
  END IF;

  IF v_kind = 'full' THEN
    UPDATE reservations SET status = 'completed' WHERE id = v_res.id;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.reservation_hourly_rate(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.extend_reservation_stay(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_reservation_checkout(uuid, integer, integer, text, integer, integer, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_hourly_rate(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.extend_reservation_stay(uuid, timestamptz, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_reservation_checkout(uuid, integer, integer, text, integer, integer, text, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 5. no_show 不再佔時段：店員確認沒來之後，上一組就能延長、空出來的時段也能再訂
--    新條件涵蓋的列是舊條件的子集合，所以新 constraint 一定建得起來；先建新的再拆舊的。
-- ---------------------------------------------------------------------------
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_no_overlap_active_excl;
ALTER TABLE reservations
  ADD CONSTRAINT reservations_no_overlap_active_excl
  EXCLUDE USING gist (
    room_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'no_show'));
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_no_overlap_excl;

COMMENT ON CONSTRAINT reservations_no_overlap_active_excl ON reservations IS
  'Prevents overlapping reservations for the same room; cancelled and no_show release the slot (#444)';

INSERT INTO schema_migrations (version, name)
VALUES ('20261014-reservation-settlements', 'migration-reservation-settlements.sql')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- 回滾（只在應用程式還沒開始寫入新表時可直接執行；已有結帳紀錄就先匯出備份）：
-- BEGIN;
--   -- 先確認沒有 no_show 和其他組重疊，否則舊 constraint 建不回來：
--   -- SELECT a.id, b.id FROM reservations a JOIN reservations b
--   --   ON a.room_id = b.room_id AND a.id < b.id
--   --  WHERE a.status <> 'cancelled' AND b.status <> 'cancelled'
--   --    AND a.start_time < b.end_time AND a.end_time > b.start_time;
--   ALTER TABLE reservations ADD CONSTRAINT reservations_no_overlap_excl
--     EXCLUDE USING gist (room_id WITH =, tstzrange(start_time, end_time, '[)') WITH &&)
--     WHERE (status IS DISTINCT FROM 'cancelled');
--   ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_no_overlap_active_excl;
--   DROP FUNCTION IF EXISTS public.settle_reservation_checkout(uuid, integer, integer, text, integer, integer, text, text, text);
--   DROP FUNCTION IF EXISTS public.extend_reservation_stay(uuid, timestamptz, timestamptz, text);
--   DROP FUNCTION IF EXISTS public.reservation_hourly_rate(uuid, timestamptz);
--   DROP TABLE IF EXISTS reservation_settlements;
--   DROP TABLE IF EXISTS reservation_extensions;
--   DELETE FROM schema_migrations WHERE version = '20261014-reservation-settlements';
-- COMMIT;
