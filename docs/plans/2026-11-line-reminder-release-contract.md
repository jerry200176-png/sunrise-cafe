# LINE 提醒：安全發布驗證的後續設計

本文件是尚未驗收的候選方案；目前不得以它解開 #525 的發布阻擋，也不得呼叫正式 claim 測試。該草稿只讀 catalog 後仍回報 unknown。PostgREST 12.2.12 隔離實測的 OPTIONS、GET、`db-pre-request`、`db-root-spec` 和自訂 typmodout 反例記錄在 #525。

## 需要同時成立的證據

1. 資料庫確實具備經審查版本的 claim 函式、唯一約束和有效權限；不可重播包含歷史 UPDATE 的舊 SQL，也不可對未知 view、RLS 或使用者型別執行程式。
2. 每個會接收正式請求的 PostgREST instance，實際暴露正確版本、簽名與角色權限；資料庫 catalog 存在並不能證明 schema cache 已更新。不可把一個負載平衡器回應推論成所有 instance 已更新。
3. 驗證路徑自身沒有 `db-pre-request`、root-spec、其他 hook 或自訂函式的副作用；必須由可信部署控制面提供版本化設定及可驗證的生效證據。否則任何線上探測保持 unknown。
4. 閘門須在 Vercel 切換正式流量之前執行，失敗保留原 deployment；不得把必定失敗的驗證移到 postdeploy，或新增 bypass 掩蓋狀態。
5. RPC 失效或回應不明時，各發送者不得走無 claim 的旗標相容路徑。本候選修正只處理此點，並不證明其餘條件。

## 候選方向與缺口

先調查官方 Supabase/PostgREST 控制面能否提供逐 instance 的已載入 schema 版本、有效角色及確認配置且不執行使用者 SQL。若無此能力，可設計**新的、版本化的無副作用驗證契約**：受審 migration 在同一 transaction 中建立新名稱的 claim 與只回傳版本的 canary，舊 claim 與 ledger 保持相容；但不能因 canary 存在就自動假定 claim 存在。實作之前須以 PostgREST 實際版本的程式碼和隔離測試證明載入 snapshot 的一致性、所有 instance 都已切換、之後無並行 DDL，且驗證請求的 pre-request 等 hook 已經由可信控制面排除。若任一條件無法證明，此方向仍是 unknown。

即使 schema cache 就緒，也不能推論 LINE 已接收或終端使用者已讀。當 LINE 接收後 HTTP 回應遺失時，現有部分提醒可能把 claim 標記為 failed 並允許重試；僅要求取得 claim 不能消除這種重複。需另行設計穩定且持久化的 LINE retry key、payload/批次一致性、accepted-request-id 驗證、24 小時到期後的人工對帳，以及既有 `sending`/`failed` 的安全處置；不得批次重發歷史提醒。

## 上線前隔離驗收

- 正常、新舊部署並存、不同 RPC 簽名與 overload、角色權限漂移、錯誤 project 與 TLS 驗證失敗均須覆蓋。
- 多個 PostgREST instance 分別延遲或拒絕 reload、節點替換、負載平衡黏著性、快取舊 STABLE 新 VOLATILE、schema reload 與並行 DDL，均須證明不會誤判 ready。
- 對 `db-pre-request`、root-spec、惡意 view／RLS／typmodout 設置通知或外部副作用陷阱，驗證實際候選探測完全不觸發；無法核實配置時必須阻擋。
- 合成重疊 cron／多筆摘要，claim 成功、無權限、PGRST202、timeout、部分成功後失敗皆不得未持有 claim 就發送；部分 claim 可能停留 `sending`，只能經審核對帳，不能自動重發。
- 模擬 provider 接收後逾時、409 含／不含 acceptance evidence、不同 payload 使用相同 key、超過 retry window、發送後資料庫更新失敗與執行程序中斷；必須同時檢查訊息次數與持久狀態。
- 確認舊程式／新程式與原 ledger 的前向及回滾相容性、備份還原及 additive gate；先於流量切換完成經獨立審查的驗證。

## 隔離原型（不是 migration）

`scripts/experiments/test-synthetic-line-claim-batch.sh` 只在 `--network none` 的臨時 PostgreSQL 17 容器建立合成表與函式；不讀正式服務、資料或憑證。原型在同一 transaction 依固定排序取得整批 claim，回傳每個 claim 的隨機 token 及遞增 generation；確認尚未呼叫 provider 時，僅以 key + token + generation + sending 狀態條件釋放。未知的 sending 與歷史 failed 不自動重領。

合成實測涵蓋：第二項衝突使第一項 INSERT 回滾；兩個 worker 同時要求相同 guest/group 集合時只有一個得到整批；重新認領後舊 token/generation 不能釋放新 owner；sending 和歷史 failed 不能由原型自動重領。這**沒有**證明不同集合的競爭安全：例如舊 worker 分別只 claim guest 或 group，兩者仍可同時成功。因此正式方案仍需阻擋／隔離舊 worker、驗證呼叫者要求的集合完整、把訂位狀態轉換與 claim 的競態納入設計，並單獨測試 provider 接收後 timeout、lost claim response、跨 instance cache 和 migration 回滾。這些前提未成立前不得部署或將概念證據當作不重複發送的保證。
