# 昇咖啡訂位系統

Next.js + Supabase 打造的包廂訂位系統，含客人自助訂位、我的訂位查詢與取消、後台訂位管理與儀表板。

## 功能

- **客人端**：選分店／包廂／日期與時段、填寫資料預約；以電話查詢訂位、24 小時前可取消。
- **後台**：分店與包廂管理、訂位列表與編輯、儀表板（今日訂位數、使用中包廂、預估營收、時間軸視圖）。

## 技術

- Next.js 14 (App Router)、TypeScript、Tailwind CSS
- Supabase（PostgreSQL、Realtime）
- 部署建議：Vercel

## 本機開發

1. 複製 `.env.local.example` 為 `.env.local`，填入 Supabase 專案的 URL、anon key 與 service role key。
2. 在 Supabase Dashboard 執行 `supabase/schema.sql` 及所需 migration、RLS。
3. 安裝依賴並啟動：

   ```bash
   npm install
   npm run dev
   ```

4. 開啟 http://localhost:3000 。

## 部署上線

**請依 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) 操作**，包含：

- 在 VS Code / Cursor 初始化 Git 並 Push 到 GitHub
- 在 GitHub 建立新專案（Repository）
- 在 Vercel 匯入專案並設定環境變數（`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`）
- 日後以 Commit 與 Push 更新線上網站

## 授權

私人專案。
