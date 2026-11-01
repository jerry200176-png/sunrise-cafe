# LINE reminder 版本切換與回滾：審核草案

**禁止將本文或附帶合成 SQL 當成正式執行指令。** #527 尚有部分 claim、並行釋出與 provider 結果不明的 P1；#525 的 PostgREST readiness 也是 unknown。以下是供審核的切換契約及驗收清單，尚沒有可部署 migration、完整 sender 改造、正式身分證據或經演練的正式回滾。任何一步不能證明就保持原發布暫停並停止切換。

## 版本與不變條件

- **V1** 是目前所有可能發送提醒、讀寫 `line_reminder_deliveries` 的程式、背景排程、手動端點及其有效資料庫角色；不能僅憑 Vercel 某次 deployment 代表全部 V1 已停。
- **V2** 必須是另行審核的版本化契約：以資料庫中已驗證的預訂及分店/LINE 官方帳號關係選出完整收件集合，原子完成必要 claim 與 reservation lifecycle 轉換；按持久 owner token + generation CAS，發送前提交 attempted。實際觸發器、權限及鎖順序須另行納入，合成函式不是其替代品。
- **相容回退版** 必須事先建置、審查並演練，讀寫同一 V2 ledger，遵守同一 attempted/unknown 禁止自動重送規則及官方帳號身分；不是目前的 V1，也不能在回退時重開 V1 的 RPC、表寫入或 LINE 憑證。不存在合格回退版時，只能維持維護與人工處理，不能為恢復服務放寬此條件。
- V1、V2 與相容回退版不得在不同 ledger 中同時獨立決定同一通知可發送。舊 `sent` 不能重新發送；舊 `failed`、`sending` 與 provider 結果不明的記錄均須視為不確定，禁止批次轉成可重試。歷史資料只按經審核且最小揭露的個案作對帳。

## 離線前置準備與核准資料

1. 列出每個 LINE sender、cron、重試來源、手動 API、舊 deployment 可達入口及可以直接呼叫資料庫或 LINE 的服務／人員；列出實際 DB role 與 inherited / SET ROLE、RLS bypass、function owner、既有 grants、其他資料庫連線與外部 LINE 憑證。須以受授權、只讀且不揭露顧客資料或憑證的證據核實；目前未完成。
2. 明確標定唯一正式 Supabase project、DB、PostgREST 所有服務實例與部署版本；以可信控制面確認 hook、schema cache、角色權限、TLS 與專案關聯。不能把 URL 字串、單個 canary、單次 load balancer 回應或 `rate_limit_mode` 視作已驗證。#525 所列 cache/hook 前提未解以前不能宣稱 ready。
3. 確認每個現役分店的官方帳號、訊息 API 憑證、接收對象與 provider identity，並用獨立管道驗證其相符；不要因環境變數名稱推定帳號。其他已封存分店不納入。驗收資料只留非敏感指紋及證據位置，不留 token、電話或訊息內容。
4. 在**隔離環境**按實際 schema 與測試帳號重演：加版順序、所有舊 writer 的隔離、同一訂位 guest/group 原子性、來源表／RLS／觸發器、失敗分支及相容回退版。確認可靠備份、解密還原測試、受影響表和資料範圍；備份存在不等於已驗證可還原。
5. 準備完整 migration 執行包、精確 source SHA、差異與 checksum、角色授權變更、operator 權責與回復步驟；通過原有 additive gate、獨立審查及演練。不得重播現有包含歷史 UPDATE 的 migration，不要修改 gate 以便通過。本研究目前沒有正式 SQL 執行包。

## 有條件的切換順序

1. 啟用可稽核的維護／停止發送狀態，關閉所有 cron、備援排程、手動發送及其他入口，阻止新 V1 任務；在可信的部署與網路控制面阻止舊 worker 重啟或繼續使用可發送的憑證。只停一個 cron、移除一個路由或撤銷 DB grant 均不足。
2. 確認已進入中的 V1 DB transaction、runtime 任務和 provider HTTP 請求均已結束，並把無法證明結果的項目保留為 unknown。PostgreSQL `pg_stat_activity` 無法單獨觀測發送 provider 的程序；時間經過也不是供應商是否接收的證據。隔離測試已證明執行中的舊 transaction 可以在 `REVOKE` 返回後提交。
3. 按審核後的 atomic 權限契約停止舊 RPC／直接寫入，檢查角色成員及 function-owner 權限，並驗證已撤權路徑確實失敗；不要假定同名角色或唯讀表足夠。只允許受控 V2 函式操作新 ledger。不能對未知的 V1 程式與 V2 同時開啟發送。
4. 執行已核准的版本化、additive migration 與權限部署；建立/保留舊 ledger，不修改歷史 rows，新增函式與 revoke/grant 在同一 transaction 中設好，避免新函式暫時對 PUBLIC 可執行。完整狀態與歷史衝突不得推定可重試；必要時回傳人工對帳狀態。
5. 依另行驗證的每個 PostgREST 實例／帳號契約，檢查正確 V2 API、scope 與 hook，且不以真實 claim 測試。schema cache 沒有可信且無副作用證據時仍停止；不得借 #527 或測試假 provider 解除 #525。
6. 在發送仍關閉的條件下切換到預先驗證的 V2，確認每個路由、sender、DB 身分、provider 帳號及資料契約。待所有上項證據與決策具備後，才按經核准的節奏恢復入口。避免以客人真實訊息作驗收，也不自動補發歷史提醒。

## unknown、錯誤與回滾

- 開始 provider 呼叫前，V2 須成功提交帶 token/generation、provider account 和不可變 payload 指紋的 attempted CAS。CAS 本身的回應若遺失，不得發送；已 attempted 但尚未送出也只能人工對帳。
- provider 接受但回應逾時、連線中斷、格式不明或無法驗證 acceptance evidence 時，狀態保持 unknown/attempted；不得自動將其標記 failed 供 V1/V2 重新 claim。持久 retry key、有效期限、跨帳號／payload 一致性及 409 acceptance evidence 的真實 provider 契約須另作獨立驗證；合成假 provider 不構成證明。
- 僅在**可證明尚未開始任何 provider 請求**且 owner/generation 仍一致時，才可有條件釋放本次持有的整批 claim；必須鎖住所有 claim，不能釋放其他 worker 的新一代 claim。若 claim 回應遺失，client 不知道 ownership，禁止猜測或清除。釋放也不等於能安全還原已完成的 reservation 取消：必須依正式 lifecycle 對帳。
- 回滾程式時，保持 V2 ledger、attempted/unknown、權限 fence 與 account 綁定；先停止並排空 V2，新流量只切到已審查相容回退版。嚴禁重新授權 V1、切換到 V1 的獨立計數或自動重放歷史 failed。若相容版不可用、身份或在途結果不明，保留停機或安全只讀模式，人工處理而不盲目重送。
- 不從較舊資料備份覆蓋新 ledger；那會抹除已送出／unknown 的證據。資料庫 schema 的 destructive rollback 另需確定無新資料與寫入、經授權備份還原及獨立審查，通常應保持 additive schema 而只回退相容程式。

## 合成驗收證據與未完成事項

`scripts/experiments/test-synthetic-line-versioned-rollout.sh` 使用沒有網路的臨時 PostgreSQL、假角色、合成 booking/ledger 和假 provider 記錄，測試 v1 `sent`／`failed`／`sending` 不被自動遷移重試、撤權後舊角色被拒絕、同一 booking 競爭只取得一組 guest/group、錯誤帳號／payload／owner 被拒、模擬已接受但回應遺失後相容 adapter 不重送，及舊 ledger 值保持不變。腳本的 freeze/drain 是測試者明確給定的假設，不是對 production 的檢測；fake provider 寫一筆合成資料也不是對 LINE 真實接受行為的證明。

先前隔離實驗額外覆蓋在途 transaction 對撤權的反例、整批釋放與開始發送競爭、錯 owner/generation 與未知結果不自動重試。尚需真實應用路徑與相容版的實作、不同 sender/版本並行、V1 在途 provider 請求與子程序排空、實際身份授權、負載平衡 schema cache、供應商認證的 timeout/409/有效期語義，以及正式相容與復原演練。這些未完成前，本文件及 #527 保持研究草稿。

## 多程序與假 provider 補充實驗

`scripts/experiments/test-synthetic-line-worker-provider.sh` 以 `--network none` 建立臨時 PostgreSQL 17，再由清空環境變數的主程序，在本機 `127.0.0.1` 隨機埠建立假 HTTP provider，啟動多個獨立 OS worker；主程序和 worker 只使用隨機合成憑證。假 provider 刻意**不做去重**，以便任何第二次 POST 都能被計數；所有資料、帳號、payload 及 DB 角色均為合成，沒有實際 LINE SDK／帳號或客人資料。

兩個獨立 worker 對同一 owner/generation 競爭，只有一個能提交 attempted；假 provider 接受後主動斷線時，另一 worker 及模擬回退再試均未再發送。另涵蓋假 provider 接受後超過本機 deadline、回傳 500、409、損壞 JSON 或不符的回應帳號，皆維持 attempted 且禁止自動第二次發送；一個成功回應則允許重複寫入已確認狀態而不重呼 provider。worker 在 attempted 後崩潰、或刻意丟棄 DB 回覆以模擬結果不明時，也不自動重試。假 provider identity 不符時在 attempted 前停止。這些是保守協定的合成斷言，不代表任何真實 LINE 409、timeout、認證或帳號身分語意；`lost-begin-response` 是刻意丟棄成功結果的程式模擬，不是真實資料庫傳輸故障注入。

撤銷合成舊 DB role 後，測試**另行啟動**仍持有假 provider token 的舊程式，證明僅靠撤銷 DB grant 並不能阻止這類程式直接呼叫其 provider；它不證明正式舊 worker、網路或憑證狀態。正式 freeze/drain、憑證隔離、provider 身分與回應證據仍須獨立核實，未知時必須保持 release hold。原型沒有解除 #527 的部分 claim 與正式 sender P1，也沒有提供可部署 migration。
