# Ops Migration Runbook — 店長／營運手冊

**CTO OS v2 · Company-first**  
**Artifact ID:** ART-001 · Registry: [`OPS_ARTIFACT_REGISTRY.md`](./OPS_ARTIFACT_REGISTRY.md)  
**Owner:** Ops / Founder  
**Review cadence:** 每週一 Inbox R-001 檢查；部署含 migration 的 commit 後 24hr 內  
**Success metric:** `IMPLEMENTATION_TRUTH.md` 三項 migration 皆 ✅ Applied  
**Retirement:** 三項皆 Applied 且驗證通過 30 天 → 移至 `docs/archive/` 或標 **RETIRED**  
**風險:** INB-001 · R-001 — 程式已上線，DB 未同步 = 雙重訂位、RBAC 無法建帳、公休日無效

> 在 Supabase Dashboard → **SQL Editor** 執行。每步完成後打勾。  
> 估計時間：**20–30 分鐘**（含驗證）

---

## 執行前

- [ ] 選擇**低流量時段**（非週五晚、假日尖峰）
- [ ] 確認 Supabase 專案為 **production**（非 staging）
- [ ] 備份：Dashboard → Database → Backups（或匯出 `reservations` CSV）

### 檢查已套用 migration

```sql
SELECT version, name, applied_at
FROM schema_migrations
ORDER BY applied_at;
```

若 `schema_migrations` 表不存在，先執行 `supabase/migration-schema-versions.sql`。

---

## Step 1 — 雙重訂位防護（必做 · 營收＋CX）

**檔案：** `supabase/migration-reservations-no-overlap.sql`

### 1a. 預檢（必須 0 筆）

```sql
SELECT a.id, b.id, a.room_id, a.start_time, a.end_time, b.start_time, b.end_time
FROM reservations a
JOIN reservations b ON a.room_id = b.room_id AND a.id < b.id
WHERE a.status <> 'cancelled' AND b.status <> 'cancelled'
  AND a.start_time < b.end_time AND a.end_time > b.start_time;
```

- **若有列** → 先聯絡客人協調取消其中一筆，再重跑預檢
- **0 筆** → 繼續

### 1b. 執行 migration 檔案全文

複製 `migration-reservations-no-overlap.sql` 內容 → Run

### 1c. 驗證

```sql
SELECT version FROM schema_migrations
WHERE version = '20260710-reservations-no-overlap';
```

- [ ] 有列 = 成功

**業務影響：** 杜絕同一包廂同時段兩組客人 → 避免客訴與營收損失

---

## Step 2 — RBAC 帳號表（必做 · 可安全聘請員工）

**檔案：** `supabase/migration-phase7-rbac.sql`

### 2a. 執行 migration 檔案全文

### 2b. 驗證

```sql
SELECT version FROM schema_migrations WHERE version = '20260710-phase7-rbac';
SELECT COUNT(*) FROM admin_users;  -- 可為 0，表存在即可
```

### 2c. 建立第一位店長帳號

1. 登入後台 `/admin/login`（沿用 `ADMIN_PASSWORD` owner session）
2. 前往 `/admin/users` → 新增帳號（role: `branch_manager` 或 `staff`）
3. 登出 → 用新帳號登入測試

- [ ] `/admin/users` 可開啟、可新增
- [ ] staff 帳號無法改價格（安全測試）

**業務影響：** 店員可分工，老闆不需共享密碼

---

## Step 3 — 分店公休日（必做 · 多分店 CX）

**檔案：** `supabase/migration-branches-closed-dates.sql`

### 3a. 執行

```sql
ALTER TABLE branches ADD COLUMN IF NOT EXISTS closed_dates JSONB DEFAULT '[]';
```

（或執行完整 migration 檔案）

### 3b. 驗證

```sql
SELECT id, name, closed_dates FROM branches LIMIT 5;
```

### 3c. 後台設定

1. `/admin` → 選擇分店 → **公休日設定** → 新增日期 → 儲存
2. 客人端 `/book` 選該日 → 應顯示不可訂

- [ ] 公休日無法完成訂位

**業務影響：** A 店公休不影響 B 店營收

---

## Step 4 — Cron 執行紀錄（建議 · 可觀測性）

**檔案：** `supabase/migration-job-runs.sql`  
**時間：** 約 2 分鐘

- [ ] SQL Editor 執行全文
- [ ] 驗證：`SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 5;`（次日 cron 後應有資料）
- [ ] `/admin/executive` → Cron 區塊 `job_runs_ready: true`

**業務影響：** 明日提醒是否成功送出可查證，不需翻 Vercel logs

---

## 完成後

- [ ] 更新 `docs/EXECUTIVE_INBOX.md` — 關閉 INB-001
- [ ] 通知團隊：可開始使用員工帳號
- [ ] 下週一執行 [`OPS_WEEKLY_BUSINESS_REVIEW.md`](./OPS_WEEKLY_BUSINESS_REVIEW.md)

---

## 回滾（僅緊急）

| Migration | 回滾 |
|-----------|------|
| overlap | `ALTER TABLE reservations DROP CONSTRAINT reservations_no_overlap_excl;` |
| RBAC | 不建議刪表（有 audit）；改停用帳號 `is_active=false` |
| closed_dates | 欄位可留；清空 `closed_dates` JSON |

---

*對應風險 R-001 · Executive Dashboard Rank 1*
