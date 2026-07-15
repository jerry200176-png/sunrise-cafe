# Commercial Maturity Baseline — 2026-07-15 (FROZEN)

**Do not edit scores in this file.** Corrections go to new dated scorecards / evidence appendices.

**Re-verify stamp:** 2026-07-15  
**main SHA:** `cfc940b`  
**production `/api/version`:** `cfc940b27e1d921e598fd922ae6c8f34f128590c` — **parity OK** [FACT]  
**booking-health:** `{"ok":true}` [FACT]  
**Agent Supabase secrets:** `SUPABASE_SERVICE_ROLE_KEY` len=18 non-JWT; `SUPABASE_DB_URL` contains `[ref]`/`[region]` placeholders — **cannot apply prod SQL from this agent** [FACT]

## Dimension baseline

| ID | Dimension | Grade | Key evidence | Certainty |
|----|-----------|-------|--------------|-----------|
| D01 | 客人訂位主路徑 | **B+** | `/book` 200; half-hour UX on main; E2E mocks lagged half-hour (CI fail on PR) | FACT |
| D02 | 訂金／付款／取消／退費 | **B−** | 截圖審核閉環 [FACT]; Stripe API 503「尚未啟用」但 `daan.stripeEnabled=true` 仍開 PaymentModal [FACT]; 已付取消僅來電 [FACT]; 無可配置退費狀態機 [FACT] | FACT |
| D03 | 店長後台與今日場控 | **B−** | dashboard/tables/payments 分離多頁 [FACT]; 無單一今日場控 [FACT] | FACT |
| D04 | 多店與設定管理 | **B** | multi-branch model + closed_dates [FACT]; `line_group_id` migration optional [FACT] | FACT |
| D05 | 安全邊界與權限 | **B−** | API session+RBAC [FACT]; catalog anon FOR ALL still on prod until migration [FACT per code + audit]; PR harden not merged | FACT |
| D06 | 備份／DR | **C** | only PowerShell backup script; no verified restore drill; Free-tier risk [FACT/HYP] | FACT/HYP |
| D07 | 可觀測性與 KPI | **C+** | North Star API 401 without session; funnel only `booking_flow_entered`; many metrics unmeasured [FACT]; Sentry/Upstash optional | FACT |
| D08 | a11y／mobile／效能／錯誤恢復 | **B** | sticky CTA, skeleton, fetch timeouts [FACT]; CWV unmeasured [FACT] | FACT |
| D09 | 工程交付品質 | **B+** | CI lint/build; unit tests strong; Playwright smoke broken vs half-hour [FACT]; Vercel Hobby rate-limit on preview [FACT] | FACT |
| D10 | 稽核／客服／爭議 | **C+** | `payment_events` + ops logs [FACT]; `payment_audit_log` design-only [FACT]; refund untracked [FACT] | FACT |

## P0 inventory at baseline

| P0 | Status |
|----|--------|
| Catalog anon write surface | Code harden on branch; **prod migration not applied** |
| Rate limit fail-open (no Upstash) | Open — no Upstash secrets in agent env |
| Stripe half-finished UX | Open — modal can show while API 503 |
| Backup/DR unverified | Open |

## Whole-product grade at baseline

**Overall: B−** — below A gate (P0 open; D05/D06/D07/D02/D03 below A−).

Computed by gate rules, **not** average of dimension letters.
