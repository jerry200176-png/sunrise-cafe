# Upstash 限流故障時的回應

## 根因與現況

#211 FD-2 已採用設定分散式限流的建議。現有 `src/lib/rate-limit.ts` 使用 Upstash 時未處理 SDK 回傳的 `reason: timeout`：SDK 預設五秒會以 `success: true` 放行；連線例外則可能變成 500 或被路由 catch 轉成 400。`booking-health` 只檢查環境變數是否非空，無法證明 Redis 連通或保護已生效。部署目前顯示 memory，代表每個 isolate 限流，並非跨實例保護。

已盤點 middleware 登入、訂位、查詢及一般 API；`guest-rate-limit.ts`、guest calendar、confirm-attendance 和 booking-funnel 另有直接呼叫。沿用現有依賴、路由和 memory 限流；無變更正式設定。Webhooks／cron 既有排除規則維持原樣。

## 參考做法與方案

- [Upstash Ratelimit timeout 文件](https://upstash.com/docs/redis/sdks/ratelimit-ts/features#timeout)：timeout 預設五秒且回傳成功，並帶 `reason: timeout`。不複製實作。
- [RFC 9110 503](https://www.rfc-editor.org/rfc/rfc9110.html#name-503-service-unavailable) 與 [RFC 6585 429](https://www.rfc-editor.org/rfc/rfc6585#section-4)：服務無法判定與客人確實超額分別回 503 和 429。
- 既有 `@upstash/ratelimit` / `@upstash/redis`（MIT）與本專案 `rateLimit`、`enforceGuestLookupLimit`，不引入新依賴。

Upstash timeout、連線例外或配置狀態不一致時，拒絕該請求並回應不含細節的 503；真正超額仍回 429；等待時間採固定短值，不洩漏識別碼、錯誤字串或憑證。只在真正超額記錄既有限流事件，避免誤報；供應商故障另輸出按類別、每 isolate 最多每分鐘一次的精簡警示，僅含類別、不含路徑、識別碼或供應商訊息。沿用 SDK 原預設 prefix 與既有共同 bucket：同一識別碼的登入、訂位與查詢仍可能互相消耗配額。這保留舊版行為，避免混版因切換 prefix 而取得兩份配額；各類別隔離另行設計。保留未設定時現有的 memory 降級，不能稱作跨實例。狀態頁的 Upstash grade 改為 configured_unverified；這不是連通性探測。相較 timeout 後退回本地 memory，503 能符合已選擇的「失敗時保守拒絕」，但服務故障會暫時影響受保護 API，需配合告警與復原。只把 `timeout: 0` 交給 SDK 可能讓請求無限等待，也不解決例外回應。

## 驗證與限制

以合成 SDK 回傳驗證成功、超額、timeout、例外與中途缺 limiter；直接路由與 middleware 測 503/429，確定不誤寫限流日誌；測試 memory 應維持現狀。使用真實 SDK 和合成共享 store 測試舊版預設 constructor 與新版交錯時共同計數；這不是獨立程序或真實 Redis 測試。舊版在 SDK timeout 時仍放行，因此須證明舊 worker 已排空才能宣稱新版 timeout 保護全面生效；回退同樣會恢復放行。正式設定或 SDK 不一致仍會影響切換，須先核對；兩項設定均無時仍為 per-isolate memory。一般 API 的既有 cron 判斷可被偽造的 `x-vercel-cron-schedule` 繞過，#456 尚未部署，本改動不修正或聲稱消除該限制。此變更不新增／讀取／設定正式憑證，不探測或聲稱 Upstash 可用，也不發送正式客人通知。設定後仍需以經授權的安全測試及監測確認跨實例限制；單一 health JSON 不足以證明。若 Upstash 不穩，回退此程式會恢復 SDK timeout 放行，應先修復依賴而非視為安全回復。

既有 SDK `analytics: true` 在應用程式讀到 timeout 前可能先以 SDK 的 `success: true` 記錄分析，故供應商面板的成功數不能證明應用程式放行；SDK 自身處理 analytics 失敗時也可能記錄其錯誤物件。此 PR 不更動既有 analytics 行為，實際啟用前須另行評估日誌隱私及觀測指標。
