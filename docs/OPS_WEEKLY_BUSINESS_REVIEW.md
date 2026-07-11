# Weekly Business Review — 15 分鐘營運儀式

**CTO OS v2 · Company-first**  
**Owner:** Founder / 店長  
**頻率：** 每週一 10:00（或訂位高峰前）  
**工具：** Supabase SQL Editor · 後台 `/admin/payments`

> 解決 INB-005 / R-004：**在寫更多程式之前，先讓公司看得見營收健康度。**

---

## 為什麼這比寫 code 優先？

| 沒有這份儀式 | 有這份儀式 |
|--------------|------------|
| 不知道訂金率是否下滑 | 一週內發現轉換問題 |
| 工程做 #53 無法驗證成效 | 有 baseline 可比較 |
| 憑感覺排優先級 | 用數字驅動 Decision Log |

---

## 儀式流程（15 min）

| 分鐘 | 動作 |
|------|------|
| 0–5 | 執行下方 SQL → 記錄 KPI 表 |
| 5–10 | 檢查 `/admin/payments` 待審核佇列 |
| 10–15 | 決定本週 1 個動作（話術／審核／提醒） |

### KPI 記錄表（複製到每週筆記）

| 週次 | 訂金率 | 待審核數 | 逾期風險數 | 候補轉換 | 備註 |
|------|--------|----------|------------|----------|------|
| YYYY-MM-DD | % | | | % | |

---

## SQL 1 — 訂金收取率（核心營收 KPI）

**定義：** 過去 30 天內「已確認且應付訂金」的訂位中，`is_deposit_paid = true` 的比例

```sql
-- 訂金收取率（30 天）
WITH eligible AS (
  SELECT *
  FROM reservations
  WHERE status IN ('pending', 'confirmed', 'checked_in', 'completed')
    AND created_at >= now() - interval '30 days'
    AND total_price IS NOT NULL
    AND total_price > 0
)
SELECT
  COUNT(*) AS total_with_price,
  COUNT(*) FILTER (WHERE is_deposit_paid = true) AS paid,
  ROUND(100.0 * COUNT(*) FILTER (WHERE is_deposit_paid = true) / NULLIF(COUNT(*), 0), 1) AS deposit_rate_pct
FROM eligible;
```

**目標：** ≥ 85%  
**若 < 75%** → 本週優先：付款話術、審核 SLA、LINE 提醒（見 Payment SOP）

---

## SQL 2 — 訂金審核積壓（營運 SLA）

```sql
SELECT COUNT(*) AS pending_reviews,
       MIN(created_at) AS oldest_pending
FROM payment_events
WHERE status = 'pending_review';
```

**目標：** pending = 0 或 oldest < 4 小時  
**若積壓** → 當日安排 15 分鐘專心審核 `/admin/payments`

---

## SQL 3 — 即將逾期釋放（營收流失預警）

```sql
SELECT booking_code, customer_name, phone, status, created_at, start_time,
       is_deposit_paid
FROM reservations
WHERE status IN ('pending', 'confirmed')
  AND is_deposit_paid = false
  AND total_price IS NOT NULL
  AND start_time > now()
ORDER BY start_time ASC
LIMIT 20;
```

對照後台 `/admin/payments` **風險清單**（API 已算 deadline）。

**動作：** 對 `would_auto_release` 客人主動 LINE 提醒（使用分店話術）

---

## SQL 4 — 候補轉換率（滿房營收恢復）

```sql
SELECT
  COUNT(*) AS total_joined,
  COUNT(*) FILTER (WHERE status = 'booked') AS converted,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'booked') / NULLIF(COUNT(*), 0), 1) AS conversion_pct
FROM waitlist
WHERE created_at >= now() - interval '30 days';
```

**目標：** ≥ 30%

---

## SQL 5 — 本週訂位量（景氣指標）

```sql
SELECT
  DATE(start_time AT TIME ZONE 'Asia/Taipei') AS booking_date,
  COUNT(*) AS bookings
FROM reservations
WHERE status NOT IN ('cancelled')
  AND start_time >= date_trunc('week', now())
  AND start_time < date_trunc('week', now()) + interval '7 days'
GROUP BY 1
ORDER BY 1;
```

---

## SQL 6 — 系統健康（非工程 KPI）

| 檢查 | 方式 | 目標 |
|------|------|------|
| Production | 開啟 https://sunrise-cafe-six.vercel.app/book | 可訂 |
| Health API | `/api/booking-health` → `ok` | ok |
| Cron | 昨日群組是否收到明日提醒 | 有／無訂位皆正常 |

---

## 本週決策模板

完成 SQL 後，回答：

1. **訂金率是否達標？** 若否 → 優先 [`OPS_PAYMENT_SOP.md`](./OPS_PAYMENT_SOP.md) 哪一節？
2. **是否有客人會因逾期流失？** 若是 → 今日內聯絡
3. **是否需工程介入？** 僅當 SOP 無法解決時才開 Issue

記錄至 `docs/DECISION_LOG.md`（若改變優先級）。

---

## 財務影響估算（簡化）

```
週流失風險 ≈ 逾期釋放筆數 × 平均訂金（total_price × 30% 或實際訂金政策）
週改善機會 ≈ 候補轉換 × 平均包廂消費
```

不需精確會計；**方向正確即可**指導本週動作。

---

*解決 INB-005 · 提升 Revenue reliability 計分（見 HEALTH_SCORES.md）*
