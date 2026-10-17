# 技術決策紀錄（ADR）

記錄重要的技術決策、當時的背景與取捨。AI 閱讀此文件可避免「好心重構掉關鍵設計」。

---

## ADR-001：LINE 雙 Bot 架構

**決策**：群組通知與客人個人通知使用兩個獨立 LINE Official Account。

**背景**：原本用同一個 Bot。後來發現群組 Bot 的訊息也會被客人看到，且 token 安全性需要分開管理。

**取捨**：
- ✅ 群組通知與客人通知互不干擾
- ✅ 換群組帳號時不影響客人通知
- ⚠️ 需管理兩組 token，設定複雜度增加

---

## ADR-002：付款偵測用關鍵字比對，不串接 LINE Pay API

**決策**：透過 Webhook 偵測客人傳的文字/截圖，而非串接正式 LINE Pay API。

**背景**：LINE Pay 正式串接需要申請商家資格、審核週期長。店家目前用人工對帳（匯款末五碼），自動化只需判斷客人有沒有傳付款訊息。

**取捨**：
- ✅ 零申請成本，快速上線
- ✅ 支援所有付款方式（匯款、LINE Pay 截圖皆可）
- ⚠️ 依賴關鍵字，有誤判風險 → 已加問句排除機制
- ⚠️ 無法100%自動驗證金額，仍需人工確認截圖

**未來**：若需全自動，見 [docs/LINE_PAY_INTEGRATION.md](./LINE_PAY_INTEGRATION.md)。

---

## ADR-003：明日提醒只推大安店

**決策**：Cron Job 推播訂位提醒，只篩選大安店的訂位。

**背景**：系統初期只有大安店在使用群組通知功能，其他分店未建立對應 LINE 群組。

**影響**：若未來新增分店且需群組通知，需修改 `send-line/route.ts` 的篩選邏輯，或改為每個分店有獨立群組 ID。

---

## ADR-004：時區統一用 toLocaleString 轉換

**決策**：所有需要顯示台灣時間的地方，一律用：
```ts
new Date(new Date(s).toLocaleString("en-US", { timeZone: "Asia/Taipei" }))
```
而不用 `date-fns-tz` 或其他套件。

**背景**：Vercel serverless 跑 UTC，直接用 `new Date()` 或 `parseISO()` 顯示時間會差 8 小時。這個轉換方式不需要額外套件，在所有 Node.js 環境皆可用。

**注意**：此方法產生的 Date 物件再做計算可能有問題，只用於**格式化顯示**，不用於計算時間差。

---

## ADR-005：Supabase RLS 只開放 INSERT

**決策**：`reservations` 表的 RLS policy，匿名用戶只能 INSERT，不能 SELECT 他人訂位。

**背景**：防止惡意爬取所有訂位資料。查詢自己訂位透過電話號碼作為識別（service role key 在後端執行）。

---

## ADR-006：print-bridge 不部署到 Vercel

**決策**：熱感印表機橋接服務（`print-bridge/`）獨立在店內電腦執行，不部署雲端。

**背景**：熱感印表機需要 USB/網路連接，Vercel Serverless 無法存取本機裝置。

**運作方式**：店內電腦執行 `print-bridge/index.js`，前台廚房列印站發送 HTTP 到本機 port，bridge 再轉給印表機。

---

## ADR-007：訂金到期 Cron 涵蓋 pending 與 confirmed 未付款

**決策**：`fetchUnpaidDepositDueReservations()` 查詢 `status IN ('pending', 'confirmed') AND is_deposit_paid = false`。

**背景**：正常流程為後台確認後變 `confirmed`，舊查詢僅 `pending` 導致已確認未付款訂位永遠不會收到到期提醒或自動釋放。

**排除**：`checked_in`（已到店）、`cancelled`、`completed` 不納入。

**純函式**：`src/lib/deposit-deadline-eligibility.ts` 定義資格規則，供測試與文件化。

---

## ADR-008：付款截圖改為待審核，不直接標記已付（漸進式）

**決策**：LINE 圖片付款回報寫入 `payment_events`（`pending_review`），不自動設 `is_deposit_paid`。文字關鍵字仍暫時自動標記（過渡期）。

**背景**：任何圖片即標已付風險過高（誤傳、惡意標記）。目標架構見 [docs/PAYMENT_STATE_MODEL.md](./PAYMENT_STATE_MODEL.md)。

**取捨**：
- ✅ 截圖誤標風險消除
- ✅ 稽核軌跡可追蹤
- ⚠️ 店員需從後台確認（#56 待實作 UI）；過渡期可繼續用手動「標記已付」
- ⚠️ 文字關鍵字仍保留自動標記，下一階段改為審核

**資料庫**：`payment_events` 啟用 RLS，無 anon policy（與 `reservations` 相同）；僅 `service_role` 可讀寫。Migration：`supabase/migration-payment-events.sql`。

---

## ADR-009：訂位變更 API 需 admin session + Phase A 付款稽核日誌

**決策**（RC2 P1）：`PATCH`/`DELETE` `/api/reservations/[id]` 必須通過 `requireAdminApiAuth()`（middleware + handler）。付款狀態變更寫入結構化 log（`logDepositStatusChange`），暫不建 `payment_audit_log` 表。

**背景**：RC1 前任何人可 PATCH 訂位（含 `is_deposit_paid`）。P1.2 稽核發現多個 admin 路徑仍無 auth，列 RC2 P2。

**實作**：
- `src/lib/admin-api-auth.ts` — 與 `/api/admin/*` 共用 session cookie
- `POST /api/reservations` 維持公開（客人訂位）
- Phase A 日誌：無 `customer_name`/`phone`；`deposit_payment_note` 截斷 200 字

**取捨**：
- ✅ 防禦縱深（middleware + handler）
- ✅ 無 migration、可立刻上線
- ⚠️ Phase B 可查詢稽核表延後
- ⚠️ RC2 P2 前仍有其他未保護 admin 路徑（見 `docs/releases/RC2-P1.md`）

**參考**：`docs/PAYMENT_AUDIT_LOG.md`、`docs/releases/RC2-P1.md`

---

## ADR-010：雙重預訂防護 — PostgreSQL exclusion constraint

**決策**（Phase 2 P1-2）：在 `reservations` 表加上 `btree_gist` exclusion constraint，禁止同一 `room_id` 下非 `cancelled` 訂位的時間區間重疊。應用層 `hasSlotConflict` 保留為第一道檢查；DB constraint 為最終防線。

**背景**：`hasSlotConflict` + `insert` 為 read-then-write，併發請求可雙重預訂。需 DB 層原子保證。

**取捨**：
- ✅ 任何寫入路徑（API、admin、waitlist confirm、recurring）皆受保護
- ✅ 不需改寫所有 insert 為單一 RPC
- ⚠️ 需手動執行 migration；部署前須確認無既有重疊資料
- ⚠️ `cancelled` 訂位不佔用 constraint（`WHERE status IS DISTINCT FROM 'cancelled'`）

**實作**：
- `supabase/migration-reservations-no-overlap.sql`
- `src/lib/slot-conflict.ts` — 將 Postgres `23P01` 轉為 `SlotConflictError` → HTTP 409
- `insertReservationAdmin` 對 `booking_code` unique violation 重試最多 3 次

**Rollback**：`ALTER TABLE reservations DROP CONSTRAINT reservations_no_overlap_excl;`


---

## ADR-011：訂金到期公式改為「訂位前留白」，取代「訂位後起算」

**決策**：`computeDepositDeadline` 從 `min(建立訂位時間+24hr, 訂位開始時間)` 改為 `max(建立訂位時間+48hr, 訂位開始時間−6hr)`，並以「訂位開始時間」封頂。

**背景**：店主反映舊制「太狠」。實際上是兩種客人都受害：
- 提前多天訂位的客人：舊制期限固定在「建立後 24 小時」，訂位若在一週後，客人隔天就要繳訂金，跟訂位本身的急迫性無關。
- 臨時訂位的客人：舊制期限被 `min()` 壓到訂位開始時間本身，繳費窗口等於「訂位建立到開始」的極短區間。

參考市面訂位平台（OpenTable/Resy/Tock 皆於下訂當下用信用卡預授權，無「先訂後付」窗口；EZTABLE 退款/取消規則一律以「訂位前 N 小時」為錨點，而非「建立後 N 小時」）與開源訂房系統（tartware 用獨立 `deposit_due_date` 欄位，非公式推導）後，確認業界慣例的錨點是「距離訂位還有多久」，不是「訂位是何時建立的」——這正是舊制的技術病根。

**新規則**：
- 一律不早於「訂位開始前 6 小時」（給臨時訂位足夠的繳費空間）
- 一律不晚於訂位開始時間本身（不會要求已到場才繳費）
- 一般情況下給滿 48 小時（原本 24 小時）

**取捨**：
- ✅ 修正兩種客人都被舊制誤傷的情況，不需引入「先聯絡客人再決定」的人工審核流程（維持自動化，符合單店人力）
- ✅ 不影響 `shouldAutoRelease`/`shouldSendDepositReminder` 等下游邏輯，只改 `computeDepositDeadline` 一個純函式
- ⚠️ 仍是自動取消（非店主原本考慮的「整個拿掉」選項）——若之後發現誤取消率仍偏高，下一步可考慮改為「標記待審核」而非直接 `cancelled`（比照 inline 的人工確認模型）
- **2026-10-16 更新：自動取消已由 ADR-012 拿掉**；本 ADR 的期限公式仍用於提醒與顯示。

**實作**：`src/lib/deposit-deadline.ts`（`computeDepositDeadline`）+ 三處客服話術 fallback 文案（`src/lib/booking-policy.ts`、`src/lib/payment-message.ts`、`src/lib/line-cards.ts`）。

**Rollback**：改回 `Math.min(createdMs + 24 * HOUR_MS, startMs)` 並回復三處文案；純函式改動，無 migration、無資料遷移。

---

## ADR-012：未付訂金不再自動取消訂位（取代 ADR-011 的取消條款）

**日期**：2026-10-16　**決策者**：Founder（Jerry）

**決策**：訂金期限 Cron（`/api/admin/reminders/deposit-deadline`）不再因為客人未付訂金而取消訂位。逾期後訂位維持原狀態（`pending`／`confirmed`）與 `is_deposit_paid = false`。

**保留**：
- ADR-011 的期限公式（提醒、客人頁面與後台顯示用）
- 期限前 24 小時首次提醒、≤6 小時迫近提醒
- 客人自行取消（`/api/cancel-booking`）、後台取消，以及這兩者觸發的等位通知
- LINE Pay 線上付款在逾期後仍不開放（既有付款規則，未變更）

**拿掉**：逾期自動 `cancelled`、客人「訂位已釋放」卡、群組新的「訂金逾期釋放」卡、`deposit.auto_released` 稽核紀錄。ADR-012 前已發生的釋放若群組通知失敗，仍會補送那則歷史通知。

**不做**：不還原歷史上已被自動取消的訂位；不新增其他自動取消或保留時長規則。

**取捨（待 Founder 決定）**：未付訂金的訂位會一直佔住包廂時段，直到店家手動處理；候補不再因逾期而被通知；「未付訂金取消」報表只剩手動取消。

**Rollback**：revert 此 PR（純程式與文案，無 migration、無資料變更）。

