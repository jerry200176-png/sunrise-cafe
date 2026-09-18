# Fix plan — LINE「確認準時到店」後查詢不到訂位

**Status:** `PLAN_READY`  
**Date:** 2026-09-18  
**GitHub issue:** [#351](https://github.com/jerry200176-png/sunrise-cafe/issues/351)  
**Worktree:** `/home/jerry/workspace/tasks/sunrise/confirm-ontime-lookup-bug`  
**Branch:** `chore/task-confirm-ontime-lookup-bug`

---

## Problem

客人從 LINE 官方帳號點「確認準時到店」後，再點「查詢我的訂位／查看訂位詳情」時常查不到訂位。

出席確認多半成功；壞在確認後（以及提醒卡「查看／取消」）的深連結只用 `/book/query?code=`，在 LINE 內建瀏覽器沒有 `sessionStorage.booking_success_phone`，查詢頁不會 auto-search，且 API 不允許 code-only lookup。

## Goal

從 LINE 出席確認／提醒路徑進入查詢頁時，與訂金核准通知相同，使用 signed `lookup` token **一鍵**列出該筆訂位，無需再輸入電話。

## Non-goals

- 不開放「只有 booking_code、無需電話／token」的公開 lookup（隱私／枚舉防護）
- 不改 `guest_confirmed_at` 語意、不改出勤／訂金政策
- 不做 production data repair、不做 schema migration
- 不順手重做 confirm-visit 視覺殼層（CustomerShell 遷移另案）

## Root cause (confirmed)

| Layer | Behavior |
|-------|----------|
| LINE Flex | `buildReminderFlex` / `buildGuestAttendanceConfirmedFlex` → `?code=` |
| confirm-visit UI | 成功／管理 CTA → `?code=` |
| `/book/query` | auto-search 僅當 `code` + `sessionStorage` 電話 |
| `POST /api/my-bookings` | 需 `token` **或** `phone+code` **或** `phone+date` |
| Contrast | `payment-notify` 已正確 `signLookupToken` |

## Approach

Reuse existing `signLookupToken` / `verifyLookupToken` / `lookupGuestBookingByToken` / query `?token=` path. Do not invent a new auth scheme.

### Implementation steps

1. **API — emit lookup token on attendance endpoints**  
   File: `src/app/api/guest/confirm-attendance/route.ts`  
   - In `formatPayload` (or adjacent), add `lookup_token: signLookupToken(String(r.id))`.  
   - GET preview + POST success / already-confirmed all return it.

2. **confirm-visit page — prefer token deep links**  
   File: `src/app/book/confirm-visit/page.tsx`  
   - Extend `Payload` with `lookup_token?: string | null`.  
   - Success CTA +「查看或取消訂位」→  
     `lookup_token` 存在時 `/book/query?token=...`，否則 fallback `?code=`（防衛性降級）。

3. **LINE Flex builders — prefer token URLs**  
   Files: `src/lib/line-cards.ts` (+ tests)  
   - `buildReminderFlex`: accept optional `lookupToken`; `queryUrl` = token 優先，否則 code，否則 bare query.  
   - `buildGuestAttendanceConfirmedFlex`: same for「查看訂位詳情」.  
   - Call sites:  
     - `src/lib/send-line-reminder.ts` — pass `signLookupToken(reservationId)` when building reminder.  
     - `src/app/api/guest/confirm-attendance/route.ts` — pass token into guest confirmed Flex.

4. **Docs**  
   - Update `docs/workflows/README.md`: note LINE / confirm-visit use `?token=`; `?code=` auto-search still requires session phone.  
   - Short CHANGELOG entry if repo convention requires for this change class.

5. **Tests (minimum)**  
   - `confirm-attendance` route or payload helper: response includes verifiable `lookup_token`.  
   - `line-cards` / reminder: Flex JSON contains `/book/query?token=` when token provided; no regression when token omitted.  
   - Existing `lookup-token` / `my-bookings` token tests remain green.  
   - Optional: thin query-page unit/integration if already patterned — not required if Flex + API covered.

### Verification

- [ ] `npm test` (targeted + full as CI requires)
- [ ] Manual: LINE D-1 Flex → confirm →「查看訂位詳情」→ list shows booking without typing phone
- [ ] Manual: reminder「查看／取消訂位」with token → same
- [ ] Manual: legacy `?code=` alone still does not invent results (privacy intact)
- [ ] Deploy + `GET /api/version` SHA match (`npm run production-identity` / verify-production)

### Rollout

1. Single focused PR referencing #351  
2. Merge → deploy per `docs/DEPLOYMENT.md`  
3. Close #351 after production smoke on confirm → query token path  

### Risk

| Risk | Mitigation |
|------|------------|
| Token secret mismatch (`GUEST_LOOKUP_SECRET` / `SESSION_SECRET`) | Same signing path as payment approve; fail closed to `?code=` fallback only on UI if token missing |
| LINE URL length | lookup tokens already used in production Flex elsewhere |
| Scope creep into query UX redesign | Stick to deep-link auth only |

## Estimate

Small: ~4–6 files, no migration. Suitable for one PR.

## Decision

No Founder product decision needed — restores intended one-tap guest manage path already shipped for payment-approved Flex.
