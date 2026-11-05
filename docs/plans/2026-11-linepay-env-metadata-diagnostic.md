# LINE Pay 環境名稱唯讀診斷候選（#489）

## 根因與範圍

舊 inspect 透過 `vercel env pull` 把環境值寫到檔案，CLI 版本與清單完整性亦未獲確認；#554 因此暫停所有舊入口。此候選保留舊入口及其 contract，另外設 main-only 手動診斷，使用 Node 內建 fetch 呼叫固定 Vercel 專案的 list GET；不修改設定、不部署、不使用 LINE Pay API。只呈現固定三個名稱及固定三種 target 中實際觀察到的組合，永遠標示清單完整性 unknown；沒有列出不代表不存在。仍可能發生分頁、權限過濾、shared env、預覽分支或 custom environment 差異，不推論有效設定、當前部署狀態、沙盒身分或可付款。

官方 API schema 包含 value。請求 `decrypt=false` 是已標示 deprecated 的參數，不能據此保證值不會被送回。API body 只在記憶體解析，絕不有意記錄原文、原始錯誤、環境值、憑證或寫入檔案；不呼叫單筆解密端點、不 upload artifacts。受限回應大小、timeout、拒絕 redirect，錯誤僅固定訊息。JavaScript 不保證敏感字串能即時抹除，runtime/作業系統 crash、swap、網路代理與第三方基礎設施也不在應用可證明的控制範圍，不能宣稱物理記憶體已清除。

使用現有 `VERCEL_TOKEN`，不新增或輪替憑證。GitHub job 的 `permissions` 只限制 GITHUB_TOKEN，不能限制 Vercel token；當前 token 實際範圍、讀取能力、風險與團隊方案均未驗證。Vercel integration env scope 不提供官方文件中的唯讀權限；若現有 token 過寬，需另走既有 credential 治理流程，不以此候選自行建立憑證。main-only 條件依賴 GitHub 事件與保護規則，不能取代 branch/environment 控制；受信任 runner、節點與 supply chain 仍需審核。所有測試僅使用合成 token、合成回應與假 fetch，未連正式服務或檢查實際環境。此候選本身不推送、不啟用。

一次性 code-only 清單提議以前版 `8717e62c5ca4030414e05034c8b3a97a0b0ae492` 為 baseline；該版本的正式發布與健康狀態必須在任何發布前依既有流程確認。候選不自動觸發診斷；合併或發布本身不代表有執行診斷的授權或已執行診斷。

## 參考做法

- [Vercel 官方 project env list API](https://vercel.com/docs/rest-api/projects/retrieve-the-environment-variables-of-a-project-by-id-or-name)：固定 GET、回應可能有 value，`decrypt` 已 deprecated；不能把 status 200 視為值可用或清單完整。
- [Vercel CLI source](https://github.com/vercel/vercel/blob/341094e5e2e7429b1510ce3aa96647741d2eac42/packages/cli/src/util/env/get-env-records.ts)：官方 CLI 以 `envs` 接收清單；不沿用 CLI 的拉檔流程。
- [Vercel integration permissions](https://vercel.com/docs/integrations/install-an-integration/manage-integrations-reference)：環境變數 scope 含讀寫，不能把應用程式只讀程式碼等同平台 token 唯讀。
- [GitHub Actions permissions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication)：job 權限限縮 GitHub token，另外限制外部憑證及執行環境。
