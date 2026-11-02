# Code-only 建立部署：安全診斷候選

基準 `4c182c9d584992c1c3dd9df9aa485347043bba24`。候選只在本機與合成 API 測試；不改 workflow、發布／回復條件，不呼叫正式 Vercel 寫入或重新送出 deployment。

## 問題、根因與既有能力

`HTTP.request` 把 `urllib.error.HTTPError`、讀取失敗及其他例外統一包成 `Unknown`；`main` 再輸出固定錯誤。這保護敏感資料，但讓建立部署失敗時無法區分可安全公開的 HTTP 類別。現有建立步驟本來只呼叫一次；無 candidate identity 時 recovery 不推斷同 SHA 屬於本次，不應因診斷而改變這些保護。#566 的實際狀態碼及根因未知，不能從模糊訊息推測為 429。

盤點 `HTTP`、`Vercel.create`、`create_candidate`、`recover`、`main`、既有 Python 假 API 測試與 workflow：沿用固定 host、禁 redirect、禁 proxy、候選識別和恢復流程。不要印例外或原始回應，也不要新增重送或根據狀態碼推斷 provider 未建立部署。

## 設計

- 在底層分別捕捉 HTTPError 和已取得 status 後讀取回應失敗，只把嚴格型別為 `int` 的 status 映射到固定字串 `http_429`、`http_4xx`、`http_5xx`、`http_2xx`、`http_other`；非有效數字一律 `unclassified`。HTTPError 的 URL、query、reason、headers、body 與例外字串均不讀不印；不能把 429 或任何 4xx 當作確定無副作用。
- 將診斷封裝為 `Unknown` 子型別。只有實際 `Vercel.create` 呼叫中的 HTTP 類別才轉成建立階段專屬型別；前置 alias／GitHub GET 失敗不可標成 POST。2xx 的空／壞 JSON、缺少有效 ID、讀取失敗或 body 太大仍是 unknown；其他非 HTTP 例外、redirect、錯誤前的本地檢查，沿用既有固定錯誤。
- 頂層只對建立階段專屬型別輸出白名單常數及 `create outcome unknown`，仍非零退出並保留相同 workflow recovery 條件。輸出層再次檢查白名單，不能串接遠端值或 `str(exception)`。類別是診斷、不是重試、取消、回滾或解除限制的依據。

## 合成驗收與界線

以 mock opener、fake response 及合成 token、URL query、header、reason、body 測 429／其他 4xx／5xx、非法 status、2xx 無效 JSON／缺 ID／讀取逾時，以及無 HTTP status 的例外與 redirect。模擬 provider 已建立後卻回 429／5xx，驗證只 POST 一次、無 candidate identity 時仍不能自動視為安全／回滾別人；同時測 preflight GET 不誤標、所有錯誤輸出均不含 canary、不讀 HTTPError body、既有 recovery 測試不回歸。合成分類不代表真實 provider 的實作或目前故障原因。正式前需完整 CI、獨立複核與受控發布；回退程式不會撤銷已送出的部署。

## 參考做法

- [Python HTTPError](https://docs.python.org/3/library/urllib.error.html#urllib.error.HTTPError)：HTTP 錯誤有狀態欄位且本身可提供 body；僅取受控的型別化類別，不印例外或讀取其 body。
- [GitHub Actions security hardening](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)：限制 secrets 與日誌；本案沿用現有固定目的地和不輸出原始回應規則。
- [urllib3](https://github.com/urllib3/urllib3)（MIT）：區分傳輸錯誤與 HTTP 回應的診斷；不引入依賴、不照抄程式。根因是所有異常在兩層皆被無差別遮蔽，使用受限型別傳遞診斷而不改部署決策。
