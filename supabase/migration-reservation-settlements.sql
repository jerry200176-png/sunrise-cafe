-- #444 結帳紀錄：原子結帳、延長紀錄、收款資訊、no_show 釋出時段。
--
-- ⚠️ 草稿，等 Founder 看過這份 SQL 並核准確切內容後才能套用到正式環境。
--    審閱說明：docs/plans/2026-10-14-reservation-settlements.md
--
-- 只新增表、函式和換一條 constraint，不改、不刪任何既有資料列。
-- （例外：退款成功／失敗時，sync_reservation_deposit_status 會在 paid ↔ refunded 之間更新 reservations.deposit_status，
--   和現在 Stripe 退款流程寫的是同一個欄位。）
-- 退款帳本（reservation_refunds + reservation_refund_events）只能新增，trigger 擋 UPDATE／DELETE／TRUNCATE。
-- 套用前檢查（兩個都應該是 0 列；第 2 個不是 0 列也能套，只代表有舊的沒來紀錄會釋出時段）：
--   1) SELECT count(*) FROM reservations WHERE status NOT IN
--        ('pending','confirmed','checked_in','cancelled','completed','no_show');
--   2) SELECT count(*) FROM reservations WHERE status = 'no_show';
-- 回滾（保留資料）：supabase/rollbacks/reservation-settlements-keep-data.sql（見 docs/plans/2026-10-15-refund-rollback.md）。

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
  -- 現金找零（Founder D6）：只有「現金結帳、有收錢」才有。找零 = 客人付的現金 − 這次要收的金額，由伺服器算，不能手填。
  -- 找零不是退款：不能拿來退訂金（refund_amount 必須是 0）、不能用在現金以外的付款方式。
  -- 上限 100000（和 src/lib/room-settlement.ts MAX_CASH_TENDERED 一致）：超過就是輸入錯誤
  cash_tendered integer CHECK (cash_tendered BETWEEN 1 AND 100000),
  change_given integer CHECK (change_given >= 0),
  change_given_by text,
  change_given_by_role text,
  change_given_at timestamptz,
  settled_by text,
  settled_by_role text,
  settled_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (cash_tendered IS NULL AND change_given IS NULL AND change_given_by IS NULL AND change_given_by_role IS NULL
     AND change_given_at IS NULL)
    OR (payment_method = 'cash' AND amount_collected > 0 AND refund_amount = 0
        AND cash_tendered >= amount_collected AND change_given = cash_tendered - amount_collected
        AND change_given_at IS NOT NULL
        -- 有找零就一定要記下是誰找的（審閱 P2：連 service key 直接寫入也擋）
        AND (change_given = 0 OR (length(btrim(COALESCE(change_given_by, ''))) > 0
                                  AND length(btrim(COALESCE(change_given_by_role, ''))) > 0)))
  ),
  -- 現金、有收錢：一定要記客人給了多少（Founder A6-7）。0 元結帳（none）與純退款（amount_collected = 0）不在此限
  CHECK (payment_method <> 'cash' OR amount_collected = 0 OR cash_tendered IS NOT NULL),
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

-- 狀態轉換規則（終態只有 succeeded → failed 這一條例外：金流商事後回報退款失敗）
--   requested → pending | succeeded | failed | canceled
--   pending   → succeeded | failed | canceled
--   succeeded → failed
--   canceled  → succeeded | failed（只限金流商回報；發生時另記 reservation_refund_alerts 警示）
CREATE OR REPLACE FUNCTION public.refund_transition_allowed(p_from text, p_to text, p_actor_role text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_from
    WHEN 'requested' THEN p_to IN ('pending', 'succeeded', 'failed', 'canceled')
    WHEN 'pending' THEN p_to IN ('succeeded', 'failed', 'canceled')
    WHEN 'succeeded' THEN p_to = 'failed'
    WHEN 'canceled' THEN p_actor_role = 'provider' AND p_to IN ('succeeded', 'failed')
    ELSE false
  END
$$;

-- 人工退款「證據編號」格式（Founder A6-8，2026-10-15）：任意文字不算證據，依退款方式驗格式。
-- 和 src/lib/refund-actions.ts REFUND_REFERENCE_PATTERNS 必須一致（有測試直接比對這裡的字串）。
--   transfer：銀行轉帳交易序號，6–32 碼英數字或 -，至少 6 個數字
--   line_pay：LINE Pay transactionId，19 位數字
--   card    ：刷卡退刷授權碼 6 碼英數字，或 12 位數字的調閱編號（RRN）
--   other   ：「管道代碼:交易編號」，例如 JKOPAY:20261015001234
--   cash    ：沒有編號；改由操作者確認「現金已交還客人」（cash_handed_back）
CREATE OR REPLACE FUNCTION public.refund_reference_valid(p_method text, p_ref text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_ref IS NOT NULL AND CASE p_method
    WHEN 'transfer' THEN p_ref ~ '^(?=(?:[^0-9]*[0-9]){6})[0-9A-Za-z][0-9A-Za-z-]{5,31}$'
    WHEN 'line_pay' THEN p_ref ~ '^[0-9]{19}$'
    WHEN 'card' THEN p_ref ~ '^(?:[0-9A-Za-z]{6}|[0-9]{12})$'
    WHEN 'other' THEN p_ref ~ '^[A-Za-z]{2,12}:[0-9A-Za-z-]{6,40}$'
    ELSE false
  END
$$;

-- ---------------------------------------------------------------------------
-- 2b. 退款帳本（只能新增、不能改也不能刪）
--     reservation_refunds       ：每一筆退款一列（誰、何時、退多少、原因、哪筆訂位、冪等鍵）
--     reservation_refund_events ：每次狀態變化一列（requested → pending → succeeded／failed／canceled）
--     目前狀態 = 該筆退款最後一個事件。只有 succeeded 才算「真的退了」；requested／pending 都算「還在處理」。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservation_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  -- checkout_deposit_excess 一定掛在某一筆結帳紀錄底下（這是退款，不是找零；找零記在 reservation_settlements.change_given）
  settlement_id uuid REFERENCES reservation_settlements(id) ON DELETE RESTRICT,
  -- deposit = 退訂金（Stripe 或人工）；checkout_deposit_excess = 結帳時訂金比帳單多，退差額給客人
  kind text NOT NULL CHECK (kind IN ('deposit', 'checkout_deposit_excess')),
  amount integer NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('stripe', 'cash', 'card', 'line_pay', 'transfer', 'other')),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  requested_by text,
  -- provider = 金流商自己回報（例如在 Stripe 後台直接退），只限 stripe
  requested_by_role text NOT NULL CHECK (requested_by_role IN ('owner', 'branch_manager', 'provider')),
  branch_id uuid,
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'deposit' OR settlement_id IS NOT NULL),
  CHECK (requested_by_role <> 'provider' OR method = 'stripe'),
  -- 讓事件表能用 (refund_id, refund_method) 外鍵帶上退款方式，CHECK 才看得到（審閱 P2）
  CONSTRAINT uq_reservation_refunds_id_method UNIQUE (id, method),
  -- 系統外退款補登（Founder A6-2）：人工核對後補記一筆已在系統外完成的退訂金
  off_system boolean NOT NULL DEFAULT false,
  CHECK (NOT off_system OR (kind = 'deposit' AND method <> 'stripe'))
);

CREATE INDEX IF NOT EXISTS idx_reservation_refunds_reservation
  ON reservation_refunds(reservation_id, created_at);

CREATE TABLE IF NOT EXISTS reservation_refund_events (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  refund_id uuid NOT NULL REFERENCES reservation_refunds(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('requested', 'pending', 'succeeded', 'failed', 'canceled')),
  -- 金流商的退款編號（Stripe re_...）；只由金流商回報或對帳寫入
  provider_ref text,
  -- 人工退款的成功證據（Founder D7）：轉帳後五碼／交易序號、LINE Pay 交易編號、刷卡退刷單號…（不是 Stripe 編號）
  evidence_ref text,
  note text,
  actor text,
  actor_role text,
  -- 這筆退款的方式：由 BEFORE INSERT trigger 從 reservation_refunds 帶入（寫入的人填什麼都會被蓋掉），
  -- 外鍵再保證一致。下面的 CHECK 靠它判斷「非現金」（審閱 P2：連 service key 直接寫入也擋）
  refund_method text NOT NULL,
  -- 這一步之前的狀態：同一個 trigger 從最後一個事件帶入，讓 CHECK 能檢查狀態轉換（A6-9）
  previous_status text,
  -- 現金退款：操作者確認現金已實際交還客人（Founder A6-3）
  cash_handed_back boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (refund_id, refund_method) REFERENCES reservation_refunds (id, method) ON DELETE RESTRICT,
  -- 每一步都要記下是什麼角色做的
  CHECK (length(btrim(COALESCE(actor_role, ''))) > 0),
  -- 金流商身分只能用在 Stripe 退款；Stripe 退款除了「申請」之外的每一步都只能由金流商記
  CHECK (actor_role <> 'provider' OR refund_method = 'stripe'),
  CHECK (refund_method <> 'stripe' OR actor_role = 'provider' OR status = 'requested'),
  -- 只能照固定的狀態轉換走（第一列一定是 requested）
  CHECK ((previous_status IS NULL AND status = 'requested')
         OR (previous_status IS NOT NULL AND refund_transition_allowed(previous_status, status, actor_role))),
  -- 人工把退款標成成功／失敗／取消時，一定要留說明（D7）
  CHECK (actor_role = 'provider' OR status IN ('requested', 'pending') OR length(btrim(COALESCE(note, ''))) > 0),
  -- 人工標「成功」：非現金要有格式正確的證據編號（A6-8）；現金要有操作者確認已交還（A6-3）
  CHECK (actor_role = 'provider' OR status <> 'succeeded'
         OR (refund_method = 'cash' AND cash_handed_back)
         OR (refund_method <> 'cash' AND refund_reference_valid(refund_method, evidence_ref))),
  -- 人工把「已退」改成「失敗」（例如轉帳被退回）：要有格式正確的證據編號；現金交還後不能改失敗（A6-9）
  CHECK (actor_role = 'provider' OR NOT (previous_status = 'succeeded' AND status = 'failed')
         OR (refund_method <> 'cash' AND refund_reference_valid(refund_method, evidence_ref))),
  CHECK (NOT cash_handed_back OR (refund_method = 'cash' AND status = 'succeeded'))
);

-- 事件的退款方式一律從退款那一列帶入，不信任寫入的人填的值
CREATE OR REPLACE FUNCTION public.refund_event_fill_method()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  SELECT method INTO NEW.refund_method FROM reservation_refunds WHERE id = NEW.refund_id;
  SELECT status INTO NEW.previous_status FROM reservation_refund_events
    WHERE refund_id = NEW.refund_id ORDER BY seq DESC LIMIT 1;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_reservation_refund_events_fill_method ON reservation_refund_events;
CREATE TRIGGER trg_reservation_refund_events_fill_method
  BEFORE INSERT ON reservation_refund_events
  FOR EACH ROW EXECUTE FUNCTION public.refund_event_fill_method();

CREATE INDEX IF NOT EXISTS idx_reservation_refund_events_refund
  ON reservation_refund_events(refund_id, seq);
CREATE INDEX IF NOT EXISTS idx_reservation_refund_events_provider_ref
  ON reservation_refund_events(provider_ref) WHERE provider_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_reservation_refund_events_requested
  ON reservation_refund_events(refund_id) WHERE status = 'requested';

-- 只能新增：UPDATE／DELETE／TRUNCATE 一律擋下（連 service_role 也一樣）
CREATE OR REPLACE FUNCTION public.refund_ledger_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'refund_ledger_append_only' USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_reservation_refunds_append_only ON reservation_refunds;
CREATE TRIGGER trg_reservation_refunds_append_only
  BEFORE UPDATE OR DELETE ON reservation_refunds
  FOR EACH ROW EXECUTE FUNCTION public.refund_ledger_append_only();
DROP TRIGGER IF EXISTS trg_reservation_refunds_no_truncate ON reservation_refunds;
CREATE TRIGGER trg_reservation_refunds_no_truncate
  BEFORE TRUNCATE ON reservation_refunds
  FOR EACH STATEMENT EXECUTE FUNCTION public.refund_ledger_append_only();
DROP TRIGGER IF EXISTS trg_reservation_refund_events_append_only ON reservation_refund_events;
CREATE TRIGGER trg_reservation_refund_events_append_only
  BEFORE UPDATE OR DELETE ON reservation_refund_events
  FOR EACH ROW EXECUTE FUNCTION public.refund_ledger_append_only();
DROP TRIGGER IF EXISTS trg_reservation_refund_events_no_truncate ON reservation_refund_events;
CREATE TRIGGER trg_reservation_refund_events_no_truncate
  BEFORE TRUNCATE ON reservation_refund_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.refund_ledger_append_only();

ALTER TABLE reservation_refunds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_read_insert_reservation_refunds" ON reservation_refunds;
CREATE POLICY "service_read_insert_reservation_refunds" ON reservation_refunds
  FOR ALL TO service_role USING (true) WITH CHECK (true);
ALTER TABLE reservation_refund_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_read_insert_reservation_refund_events" ON reservation_refund_events;
CREATE POLICY "service_read_insert_reservation_refund_events" ON reservation_refund_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON reservation_refunds, reservation_refund_events FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON reservation_refunds, reservation_refund_events FROM service_role;

-- 每筆退款的目前狀態（最後一個事件）。security_invoker：讀的人要有底層表的權限，anon 讀不到
CREATE OR REPLACE VIEW public.reservation_refund_current
WITH (security_invoker = true) AS
SELECT r.id, r.reservation_id, r.settlement_id, r.kind, r.amount, r.method, r.reason,
       r.requested_by, r.requested_by_role, r.branch_id, r.idempotency_key, r.created_at,
       e.status, e.provider_ref, e.created_at AS status_at, e.evidence_ref, e.note AS status_note
FROM reservation_refunds r
JOIN LATERAL (
  SELECT ev.status, ev.provider_ref, ev.created_at, ev.evidence_ref, ev.note
  FROM reservation_refund_events ev
  WHERE ev.refund_id = r.id
  ORDER BY ev.seq DESC
  LIMIT 1
) e ON true;

REVOKE ALL ON public.reservation_refund_current FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reservation_refund_current TO service_role;
GRANT SELECT, INSERT ON reservation_refunds, reservation_refund_events TO service_role;

-- 結帳時欠客人的訂金差額（Founder A6-9）：取消退款申請不會讓這筆欠款消失，直到退款真的成功為止都留在待辦清單
--   owed = 結帳紀錄的 refund_amount；refunded = 已成功；in_flight = 已申請／處理中；unrequested = 還沒有人申請退的部分
CREATE OR REPLACE VIEW public.reservation_refund_obligations
WITH (security_invoker = true) AS
SELECT s.id AS settlement_id, s.reservation_id, rm.branch_id, s.settled_at, s.refund_amount AS owed,
       COALESCE(sum(c.amount) FILTER (WHERE c.status = 'succeeded'), 0)::integer AS refunded,
       COALESCE(sum(c.amount) FILTER (WHERE c.status IN ('requested', 'pending')), 0)::integer AS in_flight,
       (s.refund_amount - COALESCE(sum(c.amount) FILTER (WHERE c.status IN ('requested', 'pending', 'succeeded')), 0))::integer
         AS unrequested
FROM reservation_settlements s
JOIN reservations res ON res.id = s.reservation_id
JOIN rooms rm ON rm.id = res.room_id
LEFT JOIN reservation_refund_current c ON c.settlement_id = s.id AND c.kind = 'checkout_deposit_excess'
WHERE s.refund_amount > 0
GROUP BY s.id, rm.branch_id
HAVING s.refund_amount > COALESCE(sum(c.amount) FILTER (WHERE c.status = 'succeeded'), 0);
REVOKE ALL ON public.reservation_refund_obligations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reservation_refund_obligations TO service_role;

-- 退款警示（只能新增）：金流商回報的退款超過可退上限、在結帳已折抵訂金之後才退、取消後又回報成功。
-- 錢已經動了，帳本照實記；這裡另外留一列讓老闆／店長在後台看到並人工處理。
CREATE TABLE IF NOT EXISTS reservation_refund_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  refund_id uuid REFERENCES reservation_refunds(id) ON DELETE RESTRICT,
  -- provider_reservation_mismatch：金流商回報的退款指向另一筆訂位（由 API 在同步失敗時寫入）
  -- provider_outcome_unknown：對帳查不到 Stripe 結果、又超過重送期限（A6-6：不取消、不解鎖，等人工對帳）
  -- offsystem_refund_recorded：系統外退款補登（A6-2：每一筆都要有人複核）
  kind text NOT NULL CHECK (kind IN ('provider_over_cap', 'provider_after_checkout_credit', 'provider_succeeded_after_cancel',
                                     'provider_reservation_mismatch', 'provider_outcome_unknown', 'offsystem_refund_recorded')),
  branch_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reservation_refund_alerts_created
  ON reservation_refund_alerts(created_at DESC);
DROP TRIGGER IF EXISTS trg_reservation_refund_alerts_append_only ON reservation_refund_alerts;
CREATE TRIGGER trg_reservation_refund_alerts_append_only
  BEFORE UPDATE OR DELETE ON reservation_refund_alerts
  FOR EACH ROW EXECUTE FUNCTION public.refund_ledger_append_only();
DROP TRIGGER IF EXISTS trg_reservation_refund_alerts_no_truncate ON reservation_refund_alerts;
CREATE TRIGGER trg_reservation_refund_alerts_no_truncate
  BEFORE TRUNCATE ON reservation_refund_alerts
  FOR EACH STATEMENT EXECUTE FUNCTION public.refund_ledger_append_only();
ALTER TABLE reservation_refund_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_read_insert_reservation_refund_alerts" ON reservation_refund_alerts;
CREATE POLICY "service_read_insert_reservation_refund_alerts" ON reservation_refund_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON reservation_refund_alerts FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON reservation_refund_alerts FROM service_role;
GRANT SELECT, INSERT ON reservation_refund_alerts TO service_role;

-- 警示認領（Founder A6-4：每一個警示都要有人負責）：只能新增，每個警示一列，記誰、什麼角色、說明
CREATE TABLE IF NOT EXISTS reservation_refund_alert_acks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL UNIQUE REFERENCES reservation_refund_alerts(id) ON DELETE RESTRICT,
  acknowledged_by text NOT NULL CHECK (length(btrim(acknowledged_by)) > 0),
  acknowledged_by_role text NOT NULL CHECK (acknowledged_by_role IN ('owner', 'branch_manager')),
  note text NOT NULL CHECK (length(btrim(note)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_reservation_refund_alert_acks_append_only ON reservation_refund_alert_acks;
CREATE TRIGGER trg_reservation_refund_alert_acks_append_only
  BEFORE UPDATE OR DELETE ON reservation_refund_alert_acks
  FOR EACH ROW EXECUTE FUNCTION public.refund_ledger_append_only();
DROP TRIGGER IF EXISTS trg_reservation_refund_alert_acks_no_truncate ON reservation_refund_alert_acks;
CREATE TRIGGER trg_reservation_refund_alert_acks_no_truncate
  BEFORE TRUNCATE ON reservation_refund_alert_acks
  FOR EACH STATEMENT EXECUTE FUNCTION public.refund_ledger_append_only();
ALTER TABLE reservation_refund_alert_acks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_read_insert_reservation_refund_alert_acks" ON reservation_refund_alert_acks;
CREATE POLICY "service_read_insert_reservation_refund_alert_acks" ON reservation_refund_alert_acks
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON reservation_refund_alert_acks FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON reservation_refund_alert_acks FROM service_role;
GRANT SELECT, INSERT ON reservation_refund_alert_acks TO service_role;

-- 警示＋認領狀態；acknowledged_at 為 NULL = 還沒有人負責（未認領清單）
CREATE OR REPLACE VIEW public.reservation_refund_alerts_with_ack
WITH (security_invoker = true) AS
SELECT a.id, a.reservation_id, a.refund_id, a.kind, a.branch_id, a.detail, a.created_at,
       k.acknowledged_by, k.acknowledged_by_role, k.note AS ack_note, k.created_at AS acknowledged_at
FROM reservation_refund_alerts a
LEFT JOIN reservation_refund_alert_acks k ON k.alert_id = a.id;
REVOKE ALL ON public.reservation_refund_alerts_with_ack FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reservation_refund_alerts_with_ack TO service_role;

-- ---------------------------------------------------------------------------
-- 共用：與 src/lib/room-checkout.ts 相同的規則
--   * 平日／假日依「台北日期」判斷（週六、週日 = 假日）
--   * 四捨五入用 floor(x + 0.5)，和 JS Math.round 一致（負數也一樣）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reservation_hourly_rate(p_room_id uuid, p_start timestamptz)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    CASE WHEN extract(isodow FROM (p_start AT TIME ZONE 'Asia/Taipei')) IN (6, 7)
      THEN r.price_weekend ELSE r.price_weekday END,
    0)
  FROM rooms r
  WHERE r.id = p_room_id
$$;

-- 誰能動錢（打折、退款）：老闆，或「這間分店」的店長。
-- p_role／p_branch_ids 由 API 從登入 session 帶入（不吃前端輸入）；這裡再檢查一次。
-- 店長沒有分店清單（NULL）一律不准，避免變成全分店。
CREATE OR REPLACE FUNCTION public.can_adjust_reservation_money(p_role text, p_branch_ids uuid[], p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN p_branch_ids IS NULL OR p_branch_id = ANY (p_branch_ids)
    WHEN 'branch_manager' THEN p_branch_ids IS NOT NULL AND p_branch_id IS NOT NULL AND p_branch_id = ANY (p_branch_ids)
    ELSE false
  END
$$;

-- 已付訂金（尚未扣掉任何退款）：訂位總價的一半（無條件進位），和 getDepositAmount 一致。
-- 沒有 total_price 的舊資料：用原訂時段（不含延長）的包廂費當基礎。沒付訂金 = 0。
CREATE OR REPLACE FUNCTION public.reservation_deposit_gross(p_reservation_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res reservations%ROWTYPE;
  v_ext_minutes integer;
  v_base numeric;
BEGIN
  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id;
  IF NOT FOUND OR NOT COALESCE(v_res.is_deposit_paid, false) THEN
    RETURN 0;
  END IF;
  IF v_res.total_price IS NOT NULL THEN
    v_base := v_res.total_price;
  ELSE
    SELECT COALESCE(sum(minutes), 0) INTO v_ext_minutes
      FROM reservation_extensions WHERE reservation_id = v_res.id;
    v_base := floor(reservation_hourly_rate(v_res.room_id, v_res.start_time)
      * (extract(epoch FROM (v_res.end_time - v_res.start_time)) / 60 - v_ext_minutes) / 60.0 + 0.5);
  END IF;
  RETURN CASE WHEN v_base > 0 THEN ceil(v_base * 0.5)::integer ELSE 0 END;
END;
$$;

-- 訂金「真的已退」的金額：只算目前狀態是 succeeded 的訂金退款（部分退款只扣實際退的）。
-- 舊資料：帳本裡沒有這筆訂位的訂金退款、但 deposit_status = 'refunded'（舊的 Stripe 退款流程，一律全額）→ 視為全額已退。
CREATE OR REPLACE FUNCTION public.reservation_deposit_refunded(p_reservation_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM reservation_refunds WHERE reservation_id = p_reservation_id AND kind = 'deposit') THEN
    RETURN COALESCE((SELECT sum(amount) FROM reservation_refund_current
                      WHERE reservation_id = p_reservation_id AND kind = 'deposit' AND status = 'succeeded'), 0)::integer;
  END IF;
  IF EXISTS (SELECT 1 FROM reservations WHERE id = p_reservation_id AND deposit_status = 'refunded') THEN
    RETURN reservation_deposit_gross(p_reservation_id);
  END IF;
  RETURN 0;
END;
$$;

-- 還在處理中（requested／pending）的退款：結果未定，不算已退，也不能讓訂金再拿去折抵
CREATE OR REPLACE FUNCTION public.reservation_refund_in_flight(p_reservation_id uuid, p_kind text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM reservation_refund_current
    WHERE reservation_id = p_reservation_id AND kind = p_kind AND status IN ('requested', 'pending')
  )
$$;

CREATE OR REPLACE FUNCTION public.reservation_refund_json(p_refund_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'reservation_id', c.reservation_id, 'settlement_id', c.settlement_id, 'kind', c.kind,
    'amount', c.amount, 'method', c.method, 'status', c.status, 'provider_ref', c.provider_ref,
    'idempotency_key', c.idempotency_key, 'created_at', c.created_at, 'requested_by_role', c.requested_by_role,
    'deposit_gross', reservation_deposit_gross(c.reservation_id),
    'deposit_refunded', reservation_deposit_refunded(c.reservation_id))
  FROM reservation_refund_current c
  WHERE c.id = p_refund_id
$$;


-- 退款後同步 reservations.deposit_status（只動 Stripe 流程用的 paid／refunded，其他值不碰）：
-- 實際已退 ≥ 已付訂金 → refunded；之後退款失敗、不再全額 → 回到 paid
CREATE OR REPLACE FUNCTION public.sync_reservation_deposit_status(p_reservation_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gross integer := reservation_deposit_gross(p_reservation_id);
  v_refunded integer := reservation_deposit_refunded(p_reservation_id);
BEGIN
  IF v_gross > 0 AND v_refunded >= v_gross THEN
    UPDATE reservations SET deposit_status = 'refunded' WHERE id = p_reservation_id AND deposit_status = 'paid';
  ELSE
    UPDATE reservations SET deposit_status = 'paid' WHERE id = p_reservation_id AND deposit_status = 'refunded';
  END IF;
END;
$$;

-- 結帳畫面要用的數字（延長加總、訂金、真的已退、是否有退款處理中），和結帳函式用同一套規則。
-- API 也拿它判斷「新流程可用」：回滾時這個函式會一起拿掉，API 就退回舊流程。
CREATE OR REPLACE FUNCTION public.reservation_billing_state(p_reservation_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'extension_minutes', COALESCE((SELECT sum(minutes) FROM reservation_extensions WHERE reservation_id = p_reservation_id), 0),
    'extension_fee', COALESCE((SELECT sum(fee) FROM reservation_extensions WHERE reservation_id = p_reservation_id), 0),
    'deposit_gross', reservation_deposit_gross(p_reservation_id),
    'deposit_refunded', reservation_deposit_refunded(p_reservation_id),
    'deposit_refund_in_flight', reservation_refund_in_flight(p_reservation_id, 'deposit'))
$$;

-- 訂金還能退多少（還沒扣金流商實際收到的金額上限；那個由 API 依 Stripe 的實收傳進來）：
--   已付訂金 − 進行中與已成功的訂金退款 − 已被結帳折抵掉的部分
--   （已完成但沒有結帳紀錄的舊資料：訂金視為已在舊結帳流程折抵掉；舊流程已全額退過 = 0）
CREATE OR REPLACE FUNCTION public.reservation_deposit_refundable(p_reservation_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res reservations%ROWTYPE;
  v_credit integer;
  v_active integer;
BEGIN
  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM reservation_refunds WHERE reservation_id = v_res.id AND kind = 'deposit')
     AND v_res.deposit_status = 'refunded' THEN
    RETURN 0;
  END IF;
  SELECT COALESCE(sum(amount), 0) INTO v_active FROM reservation_refund_current
    WHERE reservation_id = v_res.id AND kind = 'deposit' AND status IN ('requested', 'pending', 'succeeded');
  SELECT deposit_credit INTO v_credit FROM reservation_settlements WHERE reservation_id = v_res.id;
  IF NOT FOUND THEN
    v_credit := CASE WHEN v_res.status = 'completed' THEN reservation_deposit_gross(v_res.id) ELSE 0 END;
  END IF;
  RETURN GREATEST(0, reservation_deposit_gross(v_res.id) - v_active - v_credit);
END;
$$;

-- ---------------------------------------------------------------------------
-- 退款請求：鎖住訂位 → 冪等鍵重送就回原本那筆 → 檢查角色／分店 → 檢查最多能退多少 → 記一筆 requested
--   訂金可退 = 已付訂金 − 進行中與已成功的訂金退款 − 已被結帳折抵掉的部分
--   （已完成但沒有結帳紀錄的舊資料：訂金視為已在舊結帳流程折抵掉，不能再退）
--   結帳差額可退 = 結帳紀錄的 refund_amount − 進行中與已成功的差額退款
--   p_amount 為 NULL = 退剩下能退的全部
--   p_provider_cap：金流商那筆付款實際還沒退的金額（整數元，API 從 Stripe 讀）；可退金額不超過它
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.request_reservation_refund(uuid, text, integer, text, text, text, text, text, uuid[]);
CREATE OR REPLACE FUNCTION public.request_reservation_refund(
  p_reservation_id uuid,
  p_kind text,
  p_amount integer,
  p_method text,
  p_reason text,
  p_idempotency_key text,
  p_actor text,
  p_actor_role text,
  p_actor_branch_ids uuid[],
  p_provider_cap integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res reservations%ROWTYPE;
  v_existing reservation_refunds%ROWTYPE;
  v_branch uuid;
  v_settlement reservation_settlements%ROWTYPE;
  v_has_settlement boolean;
  v_active integer;
  v_refundable integer;
  v_amount integer;
  v_id uuid;
BEGIN
  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT branch_id INTO v_branch FROM rooms WHERE id = v_res.room_id;

  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
  END IF;
  -- 角色檢查放在冪等重送之前：沒權限的人拿別人的冪等鍵也查不到內容
  IF NOT can_adjust_reservation_money(p_actor_role, p_actor_branch_ids, v_branch) THEN
    RAISE EXCEPTION 'refund_not_allowed' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing FROM reservation_refunds WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.reservation_id <> p_reservation_id OR v_existing.kind <> p_kind
       OR (p_amount IS NOT NULL AND v_existing.amount <> p_amount) THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = 'P0001';
    END IF;
    RETURN reservation_refund_json(v_existing.id);
  END IF;

  IF p_kind NOT IN ('deposit', 'checkout_deposit_excess') THEN
    RAISE EXCEPTION 'invalid_refund_kind' USING ERRCODE = 'P0001';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('stripe', 'cash', 'card', 'line_pay', 'transfer', 'other')
     OR (p_method = 'stripe' AND p_kind <> 'deposit') THEN
    RAISE EXCEPTION 'invalid_refund_method' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'refund_reason_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount IS NOT NULL AND p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_refund_amount' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_settlement FROM reservation_settlements WHERE reservation_id = v_res.id;
  v_has_settlement := FOUND;
  SELECT COALESCE(sum(amount), 0) INTO v_active FROM reservation_refund_current
    WHERE reservation_id = v_res.id AND kind = p_kind AND status IN ('requested', 'pending', 'succeeded');

  IF p_kind = 'deposit' THEN
    v_refundable := reservation_deposit_refundable(v_res.id);
  ELSE
    IF NOT v_has_settlement OR v_settlement.refund_amount <= 0 THEN
      RAISE EXCEPTION 'nothing_to_refund' USING ERRCODE = 'P0001';
    END IF;
    v_refundable := v_settlement.refund_amount - v_active;
  END IF;

  v_refundable := GREATEST(0, v_refundable);
  IF p_provider_cap IS NOT NULL THEN
    v_refundable := LEAST(v_refundable, GREATEST(0, p_provider_cap));
  END IF;
  v_amount := COALESCE(p_amount, v_refundable);
  IF v_refundable <= 0 THEN
    RAISE EXCEPTION 'nothing_to_refund' USING ERRCODE = 'P0001';
  END IF;
  IF v_amount > v_refundable THEN
    RAISE EXCEPTION 'refund_exceeds_refundable' USING ERRCODE = 'P0001',
      DETAIL = json_build_object('refundable', v_refundable)::text;
  END IF;

  INSERT INTO reservation_refunds (
    reservation_id, settlement_id, kind, amount, method, reason,
    requested_by, requested_by_role, branch_id, idempotency_key
  ) VALUES (
    v_res.id, CASE WHEN v_has_settlement THEN v_settlement.id END, p_kind, v_amount, p_method, btrim(p_reason),
    p_actor, p_actor_role, v_branch, p_idempotency_key
  ) RETURNING id INTO v_id;
  INSERT INTO reservation_refund_events (refund_id, status, actor, actor_role)
  VALUES (v_id, 'requested', p_actor, p_actor_role);

  RETURN reservation_refund_json(v_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 退款狀態變化：鎖住訂位（和結帳、退款請求同一把鎖）→ 驗角色 → 驗狀態轉換 → 記一筆事件
--   同一個狀態重送 = 不做事、回目前結果（冪等）。
--   Stripe 退款的任何結果（含取消）只能由金流商回報或對帳（actor_role = provider）；店長／老闆不能動 Stripe 退款的狀態。
-- ---------------------------------------------------------------------------
-- 舊版（沒有證據參數）若曾在測試環境套用過，先拿掉，避免留下兩個同名函式
DROP FUNCTION IF EXISTS public.record_reservation_refund_status(uuid, text, text, text, text, text, uuid[]);
DROP FUNCTION IF EXISTS public.record_reservation_refund_status(uuid, text, text, text, text, text, uuid[], text);
CREATE OR REPLACE FUNCTION public.record_reservation_refund_status(
  p_refund_id uuid,
  p_status text,
  p_provider_ref text,
  p_note text,
  p_actor text,
  p_actor_role text,
  p_actor_branch_ids uuid[],
  -- 人工退款的成功證據（轉帳序號等）；金流商回報不用
  p_evidence_ref text DEFAULT NULL,
  -- 現金退款：操作者確認現金已實際交還客人（A6-3）
  p_cash_handed_back boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_refund reservation_refunds%ROWTYPE;
  v_branch uuid;
  v_current text;
BEGIN
  SELECT * INTO v_refund FROM reservation_refunds WHERE id = p_refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM reservations WHERE id = v_refund.reservation_id FOR UPDATE;
  SELECT r.branch_id INTO v_branch FROM reservations res JOIN rooms r ON r.id = res.room_id
    WHERE res.id = v_refund.reservation_id;

  IF p_actor_role = 'provider' THEN
    IF v_refund.method <> 'stripe' THEN
      RAISE EXCEPTION 'refund_not_allowed' USING ERRCODE = 'P0001';
    END IF;
  ELSIF NOT can_adjust_reservation_money(p_actor_role, p_actor_branch_ids, v_branch) THEN
    RAISE EXCEPTION 'refund_not_allowed' USING ERRCODE = 'P0001';
  END IF;

  SELECT status INTO v_current FROM reservation_refund_events WHERE refund_id = v_refund.id ORDER BY seq DESC LIMIT 1;
  IF p_status = v_current THEN
    RETURN reservation_refund_json(v_refund.id);
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'succeeded', 'failed', 'canceled')
     OR NOT refund_transition_allowed(v_current, p_status, p_actor_role) THEN
    RAISE EXCEPTION 'invalid_refund_transition' USING ERRCODE = 'P0001',
      DETAIL = json_build_object('from', v_current, 'to', p_status)::text;
  END IF;
  -- Stripe 退款的任何結果（包括取消）都只能由金流商回報或對帳（reconcile）決定：
  -- 店長取消一筆結果不明的 Stripe 請求後，Stripe 可能其實退了，訂金就會被拿去折抵兩次
  IF v_refund.method = 'stripe' AND p_actor_role <> 'provider' THEN
    RAISE EXCEPTION 'provider_outcome_only' USING ERRCODE = 'P0001';
  END IF;

  -- 人工退款（Founder D7）：不能為了解除「退款處理中」就直接標成功。
  --   成功：非現金要有實際證據（轉帳序號等）＋說明；現金要有說明（誰、何時交給客人）
  --   失敗／取消：要寫原因。每一步都是一列只能新增的事件，可追查。
  IF p_actor_role <> 'provider' THEN
    IF p_provider_ref IS NOT NULL THEN
      -- 金流商編號只能由金流商回報寫入（人工證據放 evidence_ref）
      RAISE EXCEPTION 'provider_outcome_only' USING ERRCODE = 'P0001';
    END IF;
    IF p_status = 'succeeded' THEN
      IF p_note IS NULL OR length(btrim(p_note)) = 0 THEN
        RAISE EXCEPTION 'refund_evidence_required' USING ERRCODE = 'P0001';
      END IF;
      IF v_refund.method = 'cash' THEN
        -- 現金：要等現金真的交還客人、操作者確認後才算完成（A6-3）
        IF NOT COALESCE(p_cash_handed_back, false) THEN
          RAISE EXCEPTION 'cash_handback_required' USING ERRCODE = 'P0001';
        END IF;
      ELSIF p_evidence_ref IS NULL OR length(btrim(p_evidence_ref)) = 0 THEN
        RAISE EXCEPTION 'refund_evidence_required' USING ERRCODE = 'P0001';
      ELSIF NOT refund_reference_valid(v_refund.method, btrim(p_evidence_ref)) THEN
        RAISE EXCEPTION 'invalid_refund_reference' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF p_status IN ('failed', 'canceled') AND (p_note IS NULL OR length(btrim(p_note)) = 0) THEN
      RAISE EXCEPTION 'refund_reason_required' USING ERRCODE = 'P0001';
    END IF;
    -- 已退 → 失敗（A6-9）：要有退回／失敗的實際證據（格式正確的交易編號＋原因）；現金交還後不能改失敗
    IF v_current = 'succeeded' AND p_status = 'failed' THEN
      IF v_refund.method = 'cash' THEN
        RAISE EXCEPTION 'invalid_refund_transition' USING ERRCODE = 'P0001',
          DETAIL = json_build_object('from', v_current, 'to', p_status)::text;
      END IF;
      IF p_evidence_ref IS NULL OR NOT refund_reference_valid(v_refund.method, btrim(p_evidence_ref)) THEN
        RAISE EXCEPTION 'refund_failure_evidence_required' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  INSERT INTO reservation_refund_events (refund_id, status, provider_ref, evidence_ref, note, actor, actor_role, cash_handed_back)
  VALUES (v_refund.id, p_status, p_provider_ref,
    CASE WHEN p_actor_role <> 'provider' THEN NULLIF(btrim(p_evidence_ref), '') END,
    NULLIF(btrim(p_note), ''), p_actor, p_actor_role,
    p_actor_role <> 'provider' AND p_status = 'succeeded' AND v_refund.method = 'cash' AND COALESCE(p_cash_handed_back, false));

  -- 取消後金流商又回報成功：照實算已退，另外留警示（若期間已結帳折抵訂金，客人等於多拿了一次）
  IF v_current = 'canceled' AND p_status = 'succeeded' THEN
    INSERT INTO reservation_refund_alerts (reservation_id, refund_id, kind, branch_id, detail)
    VALUES (v_refund.reservation_id, v_refund.id, 'provider_succeeded_after_cancel', v_branch,
      jsonb_build_object('amount', v_refund.amount, 'provider_ref', p_provider_ref,
        'deposit_credit_at_checkout', (SELECT deposit_credit FROM reservation_settlements WHERE reservation_id = v_refund.reservation_id)));
  END IF;

  IF v_refund.kind = 'deposit' THEN
    PERFORM sync_reservation_deposit_status(v_refund.reservation_id);
  END IF;

  RETURN reservation_refund_json(v_refund.id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 金流商（Stripe webhook）回報退款：
--   有帶帳本編號（我們發起的退款，metadata.refund_ledger_id）或找得到同一個 Stripe 退款編號 → 記狀態變化；
--   都找不到 = 有人在 Stripe 後台直接退 → 新增一筆 provider 退款，照實記錄（不擋金額，因為錢已經動了）。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_provider_refund(
  p_reservation_id uuid,
  p_ledger_refund_id uuid,
  p_provider_ref text,
  p_amount integer,
  p_status text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res reservations%ROWTYPE;
  v_refund_id uuid;
  v_branch uuid;
  v_refundable integer;
  v_credit integer;
BEGIN
  IF p_provider_ref IS NULL OR length(btrim(p_provider_ref)) = 0 THEN
    RAISE EXCEPTION 'provider_ref_required' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_ledger_refund_id IS NOT NULL THEN
    SELECT id INTO v_refund_id FROM reservation_refunds WHERE id = p_ledger_refund_id;
  END IF;
  IF v_refund_id IS NULL THEN
    SELECT e.refund_id INTO v_refund_id FROM reservation_refund_events e
      WHERE e.provider_ref = p_provider_ref ORDER BY e.seq LIMIT 1;
  END IF;
  IF v_refund_id IS NULL THEN
    SELECT id INTO v_refund_id FROM reservation_refunds WHERE idempotency_key = 'stripe:' || p_provider_ref;
  END IF;

  IF v_refund_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM reservation_refunds WHERE id = v_refund_id AND reservation_id = p_reservation_id
                   AND method = 'stripe') THEN
      RAISE EXCEPTION 'refund_reservation_mismatch' USING ERRCODE = 'P0001';
    END IF;
    RETURN record_reservation_refund_status(v_refund_id, p_status, p_provider_ref, NULL, 'stripe', 'provider', NULL);
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_refund_amount' USING ERRCODE = 'P0001';
  END IF;
  SELECT branch_id INTO v_branch FROM rooms WHERE id = v_res.room_id;
  v_refundable := reservation_deposit_refundable(v_res.id);
  SELECT deposit_credit INTO v_credit FROM reservation_settlements WHERE reservation_id = v_res.id;
  INSERT INTO reservation_refunds (
    reservation_id, kind, amount, method, reason, requested_by, requested_by_role, branch_id, idempotency_key
  ) VALUES (
    v_res.id, 'deposit', p_amount, 'stripe', 'Stripe 後台直接退款（由 webhook 補記）', 'stripe', 'provider',
    v_branch, 'stripe:' || p_provider_ref
  ) RETURNING id INTO v_refund_id;
  INSERT INTO reservation_refund_events (refund_id, status, provider_ref, actor, actor_role)
  VALUES (v_refund_id, 'requested', p_provider_ref, 'stripe', 'provider');
  -- 照實記，但超過可退上限（例如結帳已經折抵了訂金）就留警示給老闆／店長
  IF p_amount > v_refundable THEN
    INSERT INTO reservation_refund_alerts (reservation_id, refund_id, kind, branch_id, detail)
    VALUES (v_res.id, v_refund_id,
      CASE WHEN COALESCE(v_credit, 0) > 0 THEN 'provider_after_checkout_credit' ELSE 'provider_over_cap' END,
      v_branch, jsonb_build_object('amount', p_amount, 'refundable', v_refundable,
        'deposit_credit_at_checkout', v_credit, 'provider_ref', p_provider_ref));
  END IF;
  IF p_status <> 'requested' THEN
    RETURN record_reservation_refund_status(v_refund_id, p_status, p_provider_ref, NULL, 'stripe', 'provider', NULL);
  END IF;
  RETURN reservation_refund_json(v_refund_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 警示：同一筆退款同一種警示，還沒有人認領時不重複新增（對帳重按也只留一列）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.raise_refund_alert(p_refund_id uuid, p_kind text, p_detail jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_refund reservation_refunds%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO v_refund FROM reservation_refunds WHERE id = p_refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM reservations WHERE id = v_refund.reservation_id FOR UPDATE;
  SELECT a.id INTO v_id FROM reservation_refund_alerts a
    WHERE a.refund_id = p_refund_id AND a.kind = p_kind
      AND NOT EXISTS (SELECT 1 FROM reservation_refund_alert_acks k WHERE k.alert_id = a.id)
    ORDER BY a.created_at LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  INSERT INTO reservation_refund_alerts (reservation_id, refund_id, kind, branch_id, detail)
  VALUES (v_refund.reservation_id, v_refund.id, p_kind, v_refund.branch_id, COALESCE(p_detail, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 認領警示（A6-4）：老闆，或警示所屬分店的店長；要寫說明。已認領過就回原本那一列（冪等）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acknowledge_refund_alert(
  p_alert_id uuid, p_note text, p_actor text, p_actor_role text, p_actor_branch_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_alert reservation_refund_alerts%ROWTYPE;
  v_ack reservation_refund_alert_acks%ROWTYPE;
BEGIN
  SELECT * INTO v_alert FROM reservation_refund_alerts WHERE id = p_alert_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'alert_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT can_adjust_reservation_money(p_actor_role, p_actor_branch_ids, v_alert.branch_id) THEN
    RAISE EXCEPTION 'refund_not_allowed' USING ERRCODE = 'P0001';
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) = 0 THEN
    RAISE EXCEPTION 'alert_note_required' USING ERRCODE = 'P0001';
  END IF;
  IF length(btrim(COALESCE(p_actor, ''))) = 0 THEN
    RAISE EXCEPTION 'refund_not_allowed' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_ack FROM reservation_refund_alert_acks WHERE alert_id = p_alert_id;
  IF NOT FOUND THEN
    INSERT INTO reservation_refund_alert_acks (alert_id, acknowledged_by, acknowledged_by_role, note)
    VALUES (p_alert_id, p_actor, p_actor_role, btrim(p_note)) RETURNING * INTO v_ack;
  END IF;
  RETURN to_jsonb(v_ack);
END;
$$;

-- ---------------------------------------------------------------------------
-- 系統外退款補登（Founder A6-2）：系統無法核實、自動退款被擋下的舊資料（例如舊流程結帳的訂位），
-- 由老闆／本分店店長在人工核對、實際退款之後補記。要有原因與格式正確的交易編號（現金要確認已交還），
-- 一次記成「已退」，並留一個需要有人認領的稽核警示（offsystem_refund_recorded）。
--   上限 = 已付訂金 − 帳本上進行中／已成功的訂金退款 − 結帳紀錄已折抵的訂金（沒有結帳紀錄不扣，因為已人工核對）
--   舊資料 deposit_status = refunded 但帳本沒有紀錄：先等 Founder 依盤點結果決定，這裡擋下（legacy_refund_status_unverified）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_offsystem_refund(
  p_reservation_id uuid,
  p_amount integer,
  p_method text,
  p_reason text,
  p_evidence_ref text,
  p_cash_handed_back boolean,
  p_idempotency_key text,
  p_actor text,
  p_actor_role text,
  p_actor_branch_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res reservations%ROWTYPE;
  v_branch uuid;
  v_existing reservation_refunds%ROWTYPE;
  v_active integer;
  v_credit integer;
  v_cap integer;
  v_id uuid;
  v_ref text := NULLIF(btrim(p_evidence_ref), '');
BEGIN
  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT branch_id INTO v_branch FROM rooms WHERE id = v_res.room_id;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT can_adjust_reservation_money(p_actor_role, p_actor_branch_ids, v_branch)
     OR length(btrim(COALESCE(p_actor, ''))) = 0 THEN
    RAISE EXCEPTION 'refund_not_allowed' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_existing FROM reservation_refunds WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.reservation_id <> p_reservation_id OR NOT v_existing.off_system OR v_existing.amount <> p_amount THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = 'P0001';
    END IF;
    RETURN reservation_refund_json(v_existing.id);
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('cash', 'card', 'line_pay', 'transfer', 'other') THEN
    RAISE EXCEPTION 'invalid_refund_method' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'refund_reason_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_refund_amount' USING ERRCODE = 'P0001';
  END IF;
  IF p_method = 'cash' THEN
    IF NOT COALESCE(p_cash_handed_back, false) THEN
      RAISE EXCEPTION 'cash_handback_required' USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_ref IS NULL THEN
    RAISE EXCEPTION 'refund_evidence_required' USING ERRCODE = 'P0001';
  ELSIF NOT refund_reference_valid(p_method, v_ref) THEN
    RAISE EXCEPTION 'invalid_refund_reference' USING ERRCODE = 'P0001';
  END IF;
  IF v_res.deposit_status = 'refunded'
     AND NOT EXISTS (SELECT 1 FROM reservation_refunds WHERE reservation_id = v_res.id AND kind = 'deposit') THEN
    RAISE EXCEPTION 'legacy_refund_status_unverified' USING ERRCODE = 'P0001';
  END IF;
  SELECT COALESCE(sum(amount), 0) INTO v_active FROM reservation_refund_current
    WHERE reservation_id = v_res.id AND kind = 'deposit' AND status IN ('requested', 'pending', 'succeeded');
  SELECT COALESCE(deposit_credit, 0) INTO v_credit FROM reservation_settlements WHERE reservation_id = v_res.id;
  v_cap := GREATEST(0, reservation_deposit_gross(v_res.id) - v_active - COALESCE(v_credit, 0));
  IF p_amount > v_cap THEN
    RAISE EXCEPTION 'refund_exceeds_refundable' USING ERRCODE = 'P0001',
      DETAIL = json_build_object('refundable', v_cap)::text;
  END IF;

  INSERT INTO reservation_refunds (
    reservation_id, kind, amount, method, reason, requested_by, requested_by_role, branch_id, idempotency_key, off_system
  ) VALUES (
    v_res.id, 'deposit', p_amount, p_method, btrim(p_reason), p_actor, p_actor_role, v_branch, p_idempotency_key, true
  ) RETURNING id INTO v_id;
  INSERT INTO reservation_refund_events (refund_id, status, note, actor, actor_role)
  VALUES (v_id, 'requested', '系統外退款補登（人工核對後）', p_actor, p_actor_role);
  INSERT INTO reservation_refund_events (refund_id, status, evidence_ref, note, actor, actor_role, cash_handed_back)
  VALUES (v_id, 'succeeded', CASE WHEN p_method <> 'cash' THEN v_ref END, btrim(p_reason), p_actor, p_actor_role,
          p_method = 'cash');
  INSERT INTO reservation_refund_alerts (reservation_id, refund_id, kind, branch_id, detail)
  VALUES (v_res.id, v_id, 'offsystem_refund_recorded', v_branch,
    jsonb_build_object('amount', p_amount, 'method', p_method, 'evidence_ref', v_ref, 'recorded_by', p_actor,
      'recorded_by_role', p_actor_role, 'reservation_status', v_res.status,
      'has_settlement', EXISTS (SELECT 1 FROM reservation_settlements WHERE reservation_id = v_res.id)));
  PERFORM sync_reservation_deposit_status(v_res.id);
  RETURN reservation_refund_json(v_id);
END;
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
SET search_path = public, pg_temp
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
-- 舊草稿（沒有分店參數、沒有找零參數）的版本若曾在測試環境套用過，先拿掉，避免留下兩個同名函式
DROP FUNCTION IF EXISTS public.settle_reservation_checkout(uuid, integer, integer, text, integer, integer, text, text, text);
DROP FUNCTION IF EXISTS public.settle_reservation_checkout(uuid, integer, integer, text, integer, integer, text, text, text, uuid[]);

CREATE OR REPLACE FUNCTION public.settle_reservation_checkout(
  p_reservation_id uuid,
  p_expected_before_discount integer,
  p_expected_refund integer,
  p_payment_method text,
  p_amount_collected integer,
  p_discount_amount integer DEFAULT 0,
  p_discount_reason text DEFAULT NULL,
  p_actor text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_actor_branch_ids uuid[] DEFAULT NULL,
  -- 現金結帳時客人實際給的現金（整數元）；NULL = 沒有找零紀錄（剛好付清或非現金）
  p_cash_tendered integer DEFAULT NULL
) RETURNS reservation_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  v_branch uuid;
  v_refund_id uuid;
  v_change integer;
  v_row reservation_settlements%ROWTYPE;
BEGIN
  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT branch_id INTO v_branch FROM rooms WHERE id = v_res.room_id;
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
    -- 訂金 = 訂位總價的一半（無條件進位），和 getDepositAmount 一致；延長不影響訂金基礎。
    -- 沒有 total_price 的舊資料：訂金基礎用原訂時段的包廂費（不含延長），和收訂金時的金額一致。
    -- 扣掉「真的已退」的部分（退款帳本 succeeded；部分退款只扣實際退的；舊資料 deposit_status = refunded = 全額）。
    -- 訂金退款還在處理中（requested／pending）：結果未定，不能折抵也不能當已退 → 先擋下結帳
    IF reservation_refund_in_flight(v_res.id, 'deposit') THEN
      RAISE EXCEPTION 'refund_in_flight' USING ERRCODE = 'P0001';
    END IF;
    v_deposit := GREATEST(0, reservation_deposit_gross(v_res.id) - reservation_deposit_refunded(v_res.id));
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

  -- 找零不能拿來退錢（Founder D6）：要退訂金差額時不准帶找零，不論角色。退款一律走退款權限與退款帳本。
  IF p_cash_tendered IS NOT NULL AND v_refund > 0 THEN
    RAISE EXCEPTION 'change_not_refund' USING ERRCODE = 'P0001';
  END IF;

  -- 退錢和打折一樣，只有老闆／本分店店長能做（角色與分店由 API 從登入 session 帶入，不吃前端輸入）
  IF v_refund > 0 AND NOT can_adjust_reservation_money(p_actor_role, p_actor_branch_ids, v_branch) THEN
    RAISE EXCEPTION 'refund_not_allowed' USING ERRCODE = 'P0001';
  END IF;

  IF v_discount < 0 THEN
    RAISE EXCEPTION 'invalid_discount' USING ERRCODE = 'P0001';
  END IF;
  IF v_discount > 0 THEN
    IF NOT can_adjust_reservation_money(p_actor_role, p_actor_branch_ids, v_branch) THEN
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

  -- 現金、有要收的錢：客人給的現金必填（Founder A6-7）
  IF p_cash_tendered IS NULL AND p_payment_method = 'cash' AND v_due > 0 THEN
    RAISE EXCEPTION 'cash_tendered_required' USING ERRCODE = 'P0001';
  END IF;

  -- 現金找零（Founder D6）：任何有結帳權限的店員都能做，但只限「現金、有收錢」的結帳。
  --   找零 = 客人付的現金 − 這次要收的金額（伺服器算，前端不能指定）；所以找零永遠不會超過「付的現金 − 帳單」，
  --   店裡現金的淨流入永遠等於 amount_collected，不可能用找零把訂金或任何錢退出去。
  IF p_cash_tendered IS NOT NULL THEN
    IF p_cash_tendered <= 0 OR p_cash_tendered > 100000 THEN
      RAISE EXCEPTION 'invalid_cash_tendered' USING ERRCODE = 'P0001';
    END IF;
    IF length(btrim(COALESCE(p_actor, ''))) = 0 OR length(btrim(COALESCE(p_actor_role, ''))) = 0 THEN
      RAISE EXCEPTION 'change_actor_required' USING ERRCODE = 'P0001';
    END IF;
    IF p_payment_method IS DISTINCT FROM 'cash' THEN
      RAISE EXCEPTION 'change_cash_only' USING ERRCODE = 'P0001';
    END IF;
    IF v_due <= 0 THEN
      RAISE EXCEPTION 'change_not_refund' USING ERRCODE = 'P0001';
    END IF;
    IF p_cash_tendered < v_due THEN
      RAISE EXCEPTION 'cash_tendered_short' USING ERRCODE = 'P0001';
    END IF;
    v_change := p_cash_tendered - v_due;
  END IF;

  INSERT INTO reservation_settlements (
    reservation_id, order_id, kind, booked_room_fee, extension_fee, room_fee,
    food_total, food_already_paid, deposit_credit, amount_before_discount,
    discount_amount, discount_reason, discount_by_role, amount_due, refund_amount,
    amount_collected, payment_method, settled_by, settled_by_role,
    cash_tendered, change_given, change_given_by, change_given_by_role, change_given_at
  ) VALUES (
    v_res.id, CASE WHEN v_has_order THEN v_order.id END, v_kind, v_booked, v_ext_fee, v_room,
    v_food, v_food_paid, v_deposit, v_before,
    v_discount, NULLIF(btrim(p_discount_reason), ''), CASE WHEN v_discount > 0 THEN p_actor_role END,
    v_due, v_refund, p_amount_collected,
    CASE WHEN v_due = 0 AND v_refund = 0 THEN 'none' ELSE p_payment_method END,
    p_actor, p_actor_role,
    p_cash_tendered, v_change,
    CASE WHEN p_cash_tendered IS NOT NULL THEN p_actor END,
    CASE WHEN p_cash_tendered IS NOT NULL THEN p_actor_role END,
    CASE WHEN p_cash_tendered IS NOT NULL THEN now() END
  ) RETURNING * INTO v_row;

  -- 結帳要退的訂金差額是「退款」（不是找零），記進退款帳本，一律先記 pending（A6-3）：
  --   現金要等真的交還客人、老闆／店長確認後才算完成；其他方式（轉帳、LINE Pay…）要等證據確認。
  --   冪等鍵綁結帳紀錄，重試不會多記。取消申請也不會讓這筆欠款消失（見 reservation_refund_obligations）。
  IF v_refund > 0 THEN
    INSERT INTO reservation_refunds (
      reservation_id, settlement_id, kind, amount, method, reason,
      requested_by, requested_by_role, branch_id, idempotency_key
    ) VALUES (
      v_res.id, v_row.id, 'checkout_deposit_excess', v_refund, p_payment_method, '結帳退訂金差額（退款，非找零）',
      p_actor, p_actor_role, v_branch, 'settlement:' || v_row.id::text
    ) RETURNING id INTO v_refund_id;
    INSERT INTO reservation_refund_events (refund_id, status, actor, actor_role)
    VALUES (v_refund_id, 'requested', p_actor, p_actor_role);
    INSERT INTO reservation_refund_events (refund_id, status, note, actor, actor_role)
    VALUES (v_refund_id, 'pending',
      CASE WHEN p_payment_method = 'cash' THEN '結帳時應以現金交還客人；交還後請老闆／店長確認（結帳紀錄 ' || v_row.id::text || '）'
           ELSE '結帳時應退訂金差額；退了之後請附證據確認（結帳紀錄 ' || v_row.id::text || '）' END, p_actor, p_actor_role);
  END IF;

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
REVOKE ALL ON FUNCTION public.can_adjust_reservation_money(text, uuid[], uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reservation_deposit_gross(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reservation_deposit_refunded(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reservation_refund_in_flight(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reservation_refund_json(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_transition_allowed(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_reservation_deposit_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_ledger_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_event_fill_method() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_reservation_refund(uuid, text, integer, text, text, text, text, text, uuid[], integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_reservation_refund_status(uuid, text, text, text, text, text, uuid[], text, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_reference_valid(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raise_refund_alert(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acknowledge_refund_alert(uuid, text, text, text, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_offsystem_refund(uuid, integer, text, text, text, boolean, text, text, text, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_reference_valid(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.raise_refund_alert(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.acknowledge_refund_alert(uuid, text, text, text, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_offsystem_refund(uuid, integer, text, text, text, boolean, text, text, text, uuid[])
  TO service_role;
REVOKE ALL ON FUNCTION public.sync_provider_refund(uuid, uuid, text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reservation_billing_state(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reservation_deposit_refundable(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_billing_state(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_reservation_refund(uuid, text, integer, text, text, text, text, text, uuid[], integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_reservation_refund_status(uuid, text, text, text, text, text, uuid[], text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_provider_refund(uuid, uuid, text, integer, text) TO service_role;
REVOKE ALL ON FUNCTION public.extend_reservation_stay(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_reservation_checkout(uuid, integer, integer, text, integer, integer, text, text, text, uuid[], integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_hourly_rate(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.extend_reservation_stay(uuid, timestamptz, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_reservation_checkout(uuid, integer, integer, text, integer, integer, text, text, text, uuid[], integer)
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
-- 回滾（保留資料）：supabase/rollbacks/reservation-settlements-keep-data.sql
--   只拿掉會寫入的函式（API 自動退回舊流程）；結帳紀錄、延長紀錄、退款帳本的表與資料全部保留。
--   不要 DROP 這些表：退款帳本是稽核紀錄，刪表需要 Founder 另外決定並先匯出備份。
--   備份、步驟與驗證：docs/plans/2026-10-15-refund-rollback.md
