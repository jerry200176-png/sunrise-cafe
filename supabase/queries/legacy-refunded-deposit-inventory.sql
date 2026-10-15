-- 盤點：舊資料 reservations.deposit_status = 'refunded'（Founder A6-5，2026-10-15）
-- ⚠️ 唯讀。整段包在 READ ONLY transaction 裡，最後 ROLLBACK；不寫任何資料。
-- 不假設這些都是全額退款：舊的 charge.refunded webhook 不管部分或全額都會標 refunded。
-- 跑法、怎麼看結果：docs/runbooks/legacy-refunded-deposit-inventory.md
-- 只用 migration 之前就有的表（reservations、payment_intents、ops_events），新舊資料庫都能跑。
--
-- 證據等級（evidence）：
--   api_full_refund_logged  舊退款 API（只會全額退）留下 payment.refund_processed 紀錄，有 Stripe 退款編號
--                           → 很可能全額，但仍要到 Stripe 對 refund_id 的金額
--   webhook_refund_only     只有 Stripe charge.refunded webhook（可能是後台部分退款）→ 部分或全額未知，要查 Stripe
--   stripe_pi_no_log        有 Stripe 付款、但沒有任何退款紀錄 → 未知，要查 Stripe
--   no_stripe_payment       沒有 Stripe 付款（轉帳／現金訂金）→ 系統裡無法判斷，要人工核對
BEGIN TRANSACTION READ ONLY;

-- 三個查詢共用同一段 CTE（READ ONLY transaction 裡不能建 temp view）
-- 1) 總數與訂金估計總額（訂金 = 訂位總價一半無條件進位；沒有 total_price 的列不計入金額，另列筆數）
WITH legacy AS (
  SELECT r.id, r.booking_code, r.status, r.total_price, r.payment_intent_id, r.start_time,
         CASE WHEN r.total_price > 0 THEN ceil(r.total_price * 0.5)::integer END AS deposit_gross_estimate
  FROM reservations r
  WHERE r.deposit_status = 'refunded'
),
api_logs AS (
  SELECT (detail->>'reservation_id') AS reservation_id, count(*) AS n,
         string_agg(DISTINCT detail->>'refund_id', ',') AS stripe_refund_ids
  FROM ops_events
  WHERE action = 'payment.refund_processed'
  GROUP BY 1
),
webhook_logs AS (
  SELECT detail->>'stripe_pi_id' AS stripe_pi_id, count(*) AS n,
         string_agg(DISTINCT detail->>'charge_id', ',') AS charge_ids
  FROM ops_events
  WHERE action = 'stripe.charge_refunded'
  GROUP BY 1
),
inv AS (
  SELECT l.id AS reservation_id, l.booking_code, l.status, l.start_time, l.total_price, l.deposit_gross_estimate,
       l.payment_intent_id, pi.amount AS pi_amount_raw, pi.status AS pi_status,
       a.stripe_refund_ids, w.charge_ids,
       CASE
         WHEN a.n > 0 THEN 'api_full_refund_logged'
         WHEN w.n > 0 THEN 'webhook_refund_only'
         WHEN l.payment_intent_id IS NOT NULL THEN 'stripe_pi_no_log'
         ELSE 'no_stripe_payment'
       END AS evidence,
       -- 系統內能判斷的只有「可能全額」；其他一律未知（不要當成全額）
       CASE WHEN a.n > 0 THEN 'likely_full_verify_in_stripe' ELSE 'unknown' END AS partial_or_full
FROM legacy l
LEFT JOIN payment_intents pi ON pi.stripe_pi_id = l.payment_intent_id
LEFT JOIN api_logs a ON a.reservation_id = l.id::text
LEFT JOIN webhook_logs w ON w.stripe_pi_id = l.payment_intent_id
)
SELECT count(*) AS legacy_refunded_rows,
       COALESCE(sum(deposit_gross_estimate), 0) AS deposit_gross_estimate_total,
       count(*) FILTER (WHERE deposit_gross_estimate IS NULL) AS rows_without_total_price
FROM inv;

-- 2) 依證據等級、部分／全額可否判斷分組
WITH legacy AS (
  SELECT r.id, r.booking_code, r.status, r.total_price, r.payment_intent_id, r.start_time,
         CASE WHEN r.total_price > 0 THEN ceil(r.total_price * 0.5)::integer END AS deposit_gross_estimate
  FROM reservations r
  WHERE r.deposit_status = 'refunded'
),
api_logs AS (
  SELECT (detail->>'reservation_id') AS reservation_id, count(*) AS n,
         string_agg(DISTINCT detail->>'refund_id', ',') AS stripe_refund_ids
  FROM ops_events
  WHERE action = 'payment.refund_processed'
  GROUP BY 1
),
webhook_logs AS (
  SELECT detail->>'stripe_pi_id' AS stripe_pi_id, count(*) AS n,
         string_agg(DISTINCT detail->>'charge_id', ',') AS charge_ids
  FROM ops_events
  WHERE action = 'stripe.charge_refunded'
  GROUP BY 1
),
inv AS (
  SELECT l.id AS reservation_id, l.booking_code, l.status, l.start_time, l.total_price, l.deposit_gross_estimate,
       l.payment_intent_id, pi.amount AS pi_amount_raw, pi.status AS pi_status,
       a.stripe_refund_ids, w.charge_ids,
       CASE
         WHEN a.n > 0 THEN 'api_full_refund_logged'
         WHEN w.n > 0 THEN 'webhook_refund_only'
         WHEN l.payment_intent_id IS NOT NULL THEN 'stripe_pi_no_log'
         ELSE 'no_stripe_payment'
       END AS evidence,
       -- 系統內能判斷的只有「可能全額」；其他一律未知（不要當成全額）
       CASE WHEN a.n > 0 THEN 'likely_full_verify_in_stripe' ELSE 'unknown' END AS partial_or_full
FROM legacy l
LEFT JOIN payment_intents pi ON pi.stripe_pi_id = l.payment_intent_id
LEFT JOIN api_logs a ON a.reservation_id = l.id::text
LEFT JOIN webhook_logs w ON w.stripe_pi_id = l.payment_intent_id
)
SELECT evidence, partial_or_full, count(*) AS rows, COALESCE(sum(deposit_gross_estimate), 0) AS deposit_gross_estimate
FROM inv
GROUP BY evidence, partial_or_full
ORDER BY evidence;

-- 3) 明細（只有 ID 與金額；不含客人姓名、電話）
WITH legacy AS (
  SELECT r.id, r.booking_code, r.status, r.total_price, r.payment_intent_id, r.start_time,
         CASE WHEN r.total_price > 0 THEN ceil(r.total_price * 0.5)::integer END AS deposit_gross_estimate
  FROM reservations r
  WHERE r.deposit_status = 'refunded'
),
api_logs AS (
  SELECT (detail->>'reservation_id') AS reservation_id, count(*) AS n,
         string_agg(DISTINCT detail->>'refund_id', ',') AS stripe_refund_ids
  FROM ops_events
  WHERE action = 'payment.refund_processed'
  GROUP BY 1
),
webhook_logs AS (
  SELECT detail->>'stripe_pi_id' AS stripe_pi_id, count(*) AS n,
         string_agg(DISTINCT detail->>'charge_id', ',') AS charge_ids
  FROM ops_events
  WHERE action = 'stripe.charge_refunded'
  GROUP BY 1
),
inv AS (
  SELECT l.id AS reservation_id, l.booking_code, l.status, l.start_time, l.total_price, l.deposit_gross_estimate,
       l.payment_intent_id, pi.amount AS pi_amount_raw, pi.status AS pi_status,
       a.stripe_refund_ids, w.charge_ids,
       CASE
         WHEN a.n > 0 THEN 'api_full_refund_logged'
         WHEN w.n > 0 THEN 'webhook_refund_only'
         WHEN l.payment_intent_id IS NOT NULL THEN 'stripe_pi_no_log'
         ELSE 'no_stripe_payment'
       END AS evidence,
       -- 系統內能判斷的只有「可能全額」；其他一律未知（不要當成全額）
       CASE WHEN a.n > 0 THEN 'likely_full_verify_in_stripe' ELSE 'unknown' END AS partial_or_full
FROM legacy l
LEFT JOIN payment_intents pi ON pi.stripe_pi_id = l.payment_intent_id
LEFT JOIN api_logs a ON a.reservation_id = l.id::text
LEFT JOIN webhook_logs w ON w.stripe_pi_id = l.payment_intent_id
)
SELECT reservation_id, booking_code, status, start_time, total_price, deposit_gross_estimate, payment_intent_id,
       pi_amount_raw, pi_status, stripe_refund_ids, charge_ids, evidence, partial_or_full
FROM inv
ORDER BY start_time;

ROLLBACK;
