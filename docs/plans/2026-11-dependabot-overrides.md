# Dependabot override 維護

## 根因與目標
Dependabot 更新直接依賴 `postcss` 時，獨立寫死的同名 override 不會一起更新；npm 要求二者的版本規格相同，因此產生 `EOVERRIDE` 並阻止依賴更新。其他傳遞依賴的精確 override 也限制安全更新。沿用現有最低版本，讓同名 override 引用直接依賴規格，其餘改為相同安全下限的相容版本範圍；不變更 Stripe SDK、API 或付款行為。現有 lockfile 繼續固定實際安裝版本。

## 參考做法
- npm 官方 [overrides](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#overrides)：以 `$` 參照直接依賴規格，避免 `EOVERRIDE`；npm CLI 為 Artistic-2.0 授權，不複製原始碼。
- GitHub [Dependabot versioning strategy](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference#versioning-strategy--)：自動更新直接依賴時須考慮版本規格與鎖檔；保留審查與 CI。
- 症狀是 Dependabot 解析失敗；根因是相同直接套件的兩份規格可以漂移。使用單一參照處理根因，並保留 security override 的現有版本下限。

## 驗證與限制
在隔離測試目錄重現版本規格漂移，再驗證引用後成功；確認 lockfile 的解析版本與 Stripe 契約不變，執行適當的安裝與檢查。#496 已合併並將 Stripe 固定在 `~22.3.2`；本工作保留該 direct dependency 與 lockfile，不改 Stripe API 版本或付款行為。日後 API/付款契約升級需獨立審查；合併順序改變時需重新比對並於最終 SHA 重跑 CI。
