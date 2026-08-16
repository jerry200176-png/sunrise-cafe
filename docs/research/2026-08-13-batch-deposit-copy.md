# 多天訂位批次複製訂金訊息研究與採用決策

## Decision and scope

本次只處理後台員工把同一位客人的多筆訂位訂金話術複製到私人 LINE 對話的人工工作台；不自動發送、不改付款狀態、不建立客服 shared inbox，也不處理 LINE Pay 商戶憑證。批次操作的安全邊界是：伺服器重新查詢訂位、沿用既有 `deposit_request` renderer、同一分店、同一聯絡資料，並為每筆寫入 append-only audit。

## Target repository evidence (locally verified)

- Repo policy：`AGENTS.md`、`docs/governance/OVERLAY.md`、`docs/internal/governance/ENGINEERING_GOVERNANCE.md`、`docs/DEPLOYMENT.md`、`docs/RUNBOOK.md`。
- 現有清單：`src/components/ReservationList.tsx` 只有單筆訊息工作台入口；訂位清單資料來自 `/api/reservations?branchId=...`。
- 現有 renderer：`src/lib/reservation-message.ts` 的 `renderReservationMessage("deposit_request", ...)` 會使用日期、時間、總金額、訂位碼、建立時間與分店付款資訊；不能由 client 傳入文字取代。
- 現有單筆 API：`src/app/api/reservations/[id]/message-actions/route.ts` 先做 admin session、分店 RBAC，再重新查詢訂位與分店資料，POST 後寫入 `reservation_message_actions`。
- 現有權限：`src/lib/rbac.ts` 的 `reservations:message_send` 對 owner、branch_manager、staff 開放，finance 不開放；`src/lib/reservation-access.ts` 已有分店範圍檢查。
- 現有 migration：`supabase/migration-reservation-message-actions.sql` 建立 append-only audit 表；本功能新增 nullable `batch_id` migration，不改付款狀態。

## Official documentation evidence

### Front mass action

Front 官方文件 `https://help.front.com/en/articles/2188`（目前頁面於本次研究讀取）記錄多選／Select all、依選取量分級 mass action、確認步驟、進度列、停止後不回滾，以及一次只執行一個 mass action。這支持本功能採用「選取 → 預覽／確認 → 顯示逐筆結果」；但 Sunrise 不照搬大批量通用操作，因為私人 LINE 複製不是可回滾的系統發送。

### Front bulk reply

Front 官方文件 `https://help.front.com/en/articles/2829184`（目前頁面於本次研究讀取）記錄 bulk reply 的同一 workspace 限制、權限前置條件、最多 50 筆、模板變數在送出時代入，以及錯誤以紅色提示標出。Sunrise 採用「同一分店／同一聯絡資料」的更嚴格限制；不採用其自動送信與 provider rate-limit 行為。

## Live public observation

- 2026-08-13 以 Cloudflare Browser Run 讀取 Front mass-action 文件，公開頁面 HTTP 200，rendered HTML 包含 `Select all`、`Proceed`、progress bar、`Stop` 與已完成動作不回滾的說明。這是公開文件頁面的觀察，不是 Front 私有架構證據。
- 2026-08-13 以 Cloudflare Browser Run 讀取 Chatwoot tag page `https://github.com/chatwoot/chatwoot/tree/v4.14.2`，公開頁面 HTTP 200，顯示固定 tag `v4.14.2` 與 canned responses 功能；這只確認公開頁面可見內容。

## Maintained open-source source and test evidence

Chatwoot repository：`https://github.com/chatwoot/chatwoot`，固定 release/tag `v4.14.2`；canned-response source/test pinned to commit `a9468409fb9d5778b847bf93f215140fc357a36b`。

- License：repository `LICENSE` 說明 enterprise 目錄與第三方例外，其他範圍採 MIT Expat；本次只採用設計概念，不複製 Ruby code。
- `app/models/canned_response.rb`：`content`、`short_code`、`account` 必填，short code 於 account 內唯一，並提供以 short code 優先的搜尋排序。
- `app/controllers/api/v1/accounts/canned_responses_controller.rb`：所有查詢都在 `Current.account` scope 下，建立／更新只 permit `short_code`、`content`，搜尋同時比對代號與內容。
- `spec/controllers/api/v1/accounts/canned_responses_controller_spec.rb`：測試未登入拒絕、登入後查詢、搜尋排序、建立、更新與刪除。

Sunrise 只採用「server-side scope、固定 template、每筆授權與測試」原則；不引入 canned-response 管理介面或通用客服資料模型。

## Pattern comparison and inference

| 證據 | 觀察 | Sunrise 採用 | 不採用 |
|---|---|---|---|
| Front | 多選、確認、進度／錯誤回報 | 選取列、預覽 modal、逐筆結果、部分失敗提示 | 自動發送、可回滾 mass action |
| Front | 同 workspace、權限與數量限制 | 同分店、同聯絡資料、RBAC、批次上限 | provider 送信節流 |
| Chatwoot | 短代號／模板、account scope、request specs | 沿用既有 renderer 與 server query；以 batch audit id 串起每筆紀錄 | 複製 Rails model/controller |

「批次複製」不等於「批次送出」是根據 Sunrise 私人 LINE 邊界與現有人工工作台的推論；Front／Chatwoot 的公開文件或 source 不證明 Sunrise 可以自動操作私人 LINE。

## Recommended adaptation

- Primary action：選取訂位後顯示「批次複製訂金訊息」，只允許 `deposit_request`。
- Preview：伺服器以 IDs 重新查詢每筆，回傳客人、日期、訂位碼、訂金與完整 canonical text；批次文字使用編號與明確分隔線。
- Guard：空選取、重複 ID、超過上限、查無訂位、跨分店、不同電話／email、缺少可判定聯絡資料、含 cancelled 或 RBAC 失敗都拒絕批次；逐筆仍可開既有工作台。
- Audit：copy success 後每筆寫 `reservation_message_actions`，共用 UUID `batch_id`，並以每筆 `reservation_id` 作 batch member 對應；錯誤不改付款狀態，UI 明確區分「已複製」與「已傳送」。
- Accessibility：每個 checkbox 有姓名／日期／訂位碼 label；modal 使用 dialog semantics、可鍵盤操作、複製結果使用 live region。

## Multi-day booking model evaluation

### Industry observations

- Mews 公開 Booking Engine API 的 reservation groups 文件：
  `https://github.com/MewsSystems/open-api-docs/blob/main/booking-engine/booking-engine-api/operations/reservation-groups.md`。
  文件模型把一個 group 對應一或多筆 reservations；group 層有 Customer／Booker、TotalAmount、PaymentRequest，子 reservation 仍各自有 StartUtc、EndUtc、Amount、Number。這是「parent booking/order + child daily reservation」的直接公開 API 證據。
- Openfront Hotel 公開頁面把 reservation、guest、folio 與 room-night inventory 分開；目前頁面標示 launching soon，因此只當產品模型觀察，不當成熟 source 或 production 架構證據。
- QloApps `v1.7.0` 可作為 PMS／reservation 產品範圍觀察，但其主體 OSL-3.0、模組 AFL-3.0；本案不複製程式碼，license 相容性也不作為採用依據。

### Target-repo constraint and minimal safe model

目前 target repo `reservations` schema 與 `Reservation` type 沒有明確的 `booking_group_id`／parent booking entity；`booking_code` 是單筆可追蹤代號，不能假設同一姓名就代表同一組訂單。既有 `phone`、姓名、分店與日期只能形成保守的「可能同一聯絡資料」視圖，不能取代正式 group identity。

因此本版不為命名硬加 parent migration，批次預覽只允許 server-side 重新查詢後通過以下保守條件：同一分店、同一標準化姓名、同一組可用電話／Email，且每筆仍以自己的 reservation id／booking code 生成與稽核。缺少聯絡資料、聯絡資料不同、跨分店、包含 cancelled 或查詢不完整時阻止「複製全部」，但保留逐筆複製；預覽本身是明確人工確認，不會自動建立或推測 group。這避免把同名客人的不同訂單誤合併。

未來若產品需要正式的多天訂位群組，建議新增 parent `booking_groups`／order entity 與 child foreign key；group 層保存 booker、總訂金與 payment request，daily reservation 保留獨立日期、金額、取消／改期與 audit。那是後續資料模型決策，不在本次人工複製工作台中偷渡。

## Risks and unknowns

- Clipboard API 可能因瀏覽器權限或非 secure context 失敗，因此保留 textarea／`document.execCommand("copy")` fallback，並允許逐筆複製。
- 瀏覽器不提供跨多次 clipboard write 的可靠批次權限；「複製全部」只寫入一個帶分隔符的文字，並在成功後才送 audit。
- 使用者尚未要求通用模板管理、同名客人合併規則或跨分店批次；本版不自行擴張。
- production migration 必須在 merge/deploy 後由受控 migration workflow 套用；正式驗收前要以 read-only evidence 確認新增欄位與 `/api/version`，不在本機猜測或輸出 secrets。

## Acceptance and rollback

- Unit：multi-date／booking-code／deposit amount renderer；batch validation and delimiter formatting。
- API：unauthenticated、finance、cross-branch、cross-contact、duplicate／empty IDs、per-item batch audit、single-action regression。
- E2E：preview、copy-all、single copy、blocked mixed-contact selection、clipboard fallback／partial error message。
- Gates：`npm ci`、migration verify、unit、lint、typecheck baseline、build、relevant Playwright；font/network noise must not mask test assertions。
- Rollback：前端/API 可回滾到上一個 commit；新增 `batch_id` 為 nullable，migration 可安全重跑，既有單筆 audit 不受影響。
