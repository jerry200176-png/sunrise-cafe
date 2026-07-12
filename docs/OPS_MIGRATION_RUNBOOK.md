# Ops Migration Runbook — 店長／營運手冊

**CTO OS v2 · Company-first**  
**Artifact ID:** ART-001 · Registry: [`OPS_ARTIFACT_REGISTRY.md`](./OPS_ARTIFACT_REGISTRY.md)  
**Owner:** Ops / Founder  
**Status:** **CORE STEPS COMPLETE** (verified 2026-07-12) — retain as reference for future migrations  
**Review cadence:** 新 migration 上線前；否則每季抽查 `schema_migrations`  
**Success metric:** `IMPLEMENTATION_TRUTH.md` critical migrations ✅ Applied — **met**  
**Retirement:** Core trio + job_runs applied → runbook is archival; optional `line_group_id` below

> 在 Supabase Dashboard → **SQL Editor** 執行。每步完成後打勾。  
> 估計時間：**20–30 分鐘**（含驗證）

---

## 目前狀態（2026-07-12）

| Step | Migration | Status |
|------|-----------|--------|
| 1 | `migration-reservations-no-overlap.sql` | ✅ Applied |
| 2 | `migration-phase7-rbac.sql` | ✅ Applied |
| 3 | `migration-branches-closed-dates.sql` | ✅ Applied |
| 4 | `migration-job-runs.sql` | ✅ Applied |
| — | `migration-payment-events.sql` | ✅ Applied (ADR-008) |
| Optional | `migration-branches-line-group-id.sql` | 🟡 Not applied — `LINE_GROUP_ID` env fallback OK |

驗證指令（需 production Supabase 憑證）：

```bash
node scripts/check-migration-drift.mjs .env.vercel.prod
```

---

## 執行前（新 migration 時）

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

## Step 1 — 雙重訂位防護（必做 · 營收＋CX） ✅ DONE

**檔案：** `supabase/migration-reservations-no-overlap.sql`

### 1a. 預檢（必須 0 筆）

```sql
SELECT a.id, b.id, a.room_id, a.start_time, a.end_time, b.start_time, b.end_time
FROM reservations a
JOIN reservations b ON a.room_id = b.room_id AND a.id < b.id
WHERE a.status <> 'cancelled' AND b.status <> 'cancelled'
  AND a.start_time < b.end_time AND a.end_time > b.start_time;
```

### 1b–1c. 驗證

```sql
SELECT version FROM schema_migrations
WHERE version = '20260710-reservations-no-overlap';
```

---

## Step 2 — RBAC 帳號表（必做 · 可安全聘請員工） ✅ DONE

**檔案：** `supabase/migration-phase7-rbac.sql`

```sql
SELECT version FROM schema_migrations WHERE version = '20260710-phase7-rbac';
SELECT COUNT(*) FROM admin_users;
```

後台：`/admin/users` 可新增 staff / branch_manager 帳號。

---

## Step 3 — 分店公休日（必做 · 多分店 CX） ✅ DONE

**檔案：** `supabase/migration-branches-closed-dates.sql`

```sql
SELECT id, name, closed_dates FROM branches LIMIT 5;
```

後台 `/admin` → 公休日設定；客人 `/book` 該日不可訂。

---

## Step 4 — Cron 執行紀錄（建議 · 可觀測性） ✅ DONE

**檔案：** `supabase/migration-job-runs.sql`

```sql
SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 5;
```

`/admin/executive` → Cron 區塊應顯示 `job_runs_ready: true`。

---

## Step 5 — 分店 LINE 群組 ID（選用 · 多分店推播）

**檔案：** `supabase/migration-branches-line-group-id.sql`  
**狀態：** 🟡 未套用 — 系統仍以 `LINE_GROUP_ID` 環境變數 fallback

套用後可在後台「分店管理」為各店設定 `line_group_id`，Cron 明日提醒會分店推播。

---

## 完成後（任何新 migration）

- [ ] 更新 `docs/IMPLEMENTATION_TRUTH.md` 同一 PR
- [ ] 更新 `docs/EXECUTIVE_INBOX.md` 若關閉/開啟風險項
- [ ] 執行 `node scripts/check-migration-drift.mjs` 驗證

---

## 回滾（僅緊急）

| Migration | 回滾 |
|-----------|------|
| overlap | `ALTER TABLE reservations DROP CONSTRAINT reservations_no_overlap_excl;` |
| RBAC | 不建議刪表（有 audit）；改停用帳號 `is_active=false` |
| closed_dates | 欄位可留；清空 `closed_dates` JSON |

---

*R-001 / INB-001 closed 2026-07-12. See `IMPLEMENTATION_TRUTH.md` for live status.*
