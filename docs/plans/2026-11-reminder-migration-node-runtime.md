# is_reminded_7d migration 的 Node 執行環境

- 問題：手動 migration workflow 在有資料庫連線時執行 `scripts/apply-migration-reminded-7d.mjs`；該腳本直接 import Supabase JS，但 lockfile 中該套件要求 Node ≥22，workflow 目前使用 Node 20。
- 盤點：搜尋全部使用 Node 20 的 workflow 及其腳本 import；只有這條可確定直接載入 Supabase JS。其他 workflow 雖安裝相同 lockfile，目前盤點到的是原生 fetch、Postgres client 或 Vercel CLI，仍可能受 npm engine-strict 或其各自依賴影響。
- 選擇與替代：改用與既有 CI 一致的 Node 22；保留 migration 腳本、資料庫、認證與 API fallback。維持 Node 20 不符合套件公開支援範圍。其他 workflow 不因只安裝依賴而推定實際執行該 SDK。
- 驗收與回滾：只讀解析 workflow 確認版本與執行腳本；用 Node 22 在 mock fetch 下載入 lockfile 指定 SDK 並執行查詢，不連線正式服務或執行 migration。回滾是還原 workflow 版本，但會重新引入不支援的執行環境。
- 參考：[Supabase Node 20 停止支援公告](https://supabase.com/changelog/45715-deprecation-notice-dropping-support-for-node-js-20)；[actions/setup-node](https://github.com/actions/setup-node)（MIT）以受管 runtime 版本供 GitHub Actions 使用。根因是執行環境版本落後於依賴宣告，而非 migration SQL 本身。
