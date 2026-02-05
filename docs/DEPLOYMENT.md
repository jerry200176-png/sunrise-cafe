# 昇咖啡訂位系統 — 部署上線指南

## 前置確認

- 專案根目錄的 [.gitignore](../.gitignore) 已包含 `.env*.local`，**本機的 .env.local 不會被推送到 GitHub**，機密不會外洩。
- 部署時必須在 **Vercel 後台** 手動設定環境變數（見下方「Vercel 環境變數」）。

---

## 一、GitHub 設定

### 1.1 在 VS Code / Cursor 中初始化 Git 儲存庫

1. 開啟專案資料夾（`Sunrise_Cafe`）。
2. 左側點 **Source Control** 圖示（或 `Ctrl+Shift+G`）。
3. 若畫面顯示「Publish to GitHub」或「Initialize Repository」：
   - 點 **Initialize Repository**，會在專案根目錄產生 `.git` 資料夾。
4. 若沒有「Initialize Repository」按鈕：
   - 上方選單 **Terminal → New Terminal**，在專案根目錄執行：
     ```bash
     git init
     ```
5. 初始化後，Source Control 會列出所有未追蹤/已修改的檔案。確認 **不要** 把 `.env.local` 加入（若 .gitignore 正確，它不會出現在清單中）。

### 1.2 第一次提交（Commit）

1. 在 Source Control 的 **Message** 輸入：`Initial commit: 昇咖啡訂位系統`
2. 點 **Commit**（或勾選「Commit Staged」）。
3. 若有提示要設定使用者名稱與 Email，在終端機執行（請改成你的資訊）：
   ```bash
   git config --global user.name "你的名字"
   git config --global user.email "your@email.com"
   ```
   再重做一次 Commit。

### 1.3 在 GitHub 網站建立新專案（Repository）

1. 登入 [github.com](https://github.com)。
2. 右上角 **+** → **New repository**。
3. 填寫：
   - **Repository name**：例如 `sunrise-cafe` 或 `sheng-coffee-booking`（自訂即可）。
   - **Description**（選填）：例如「昇咖啡包廂訂位系統」。
   - **Public**。
   - **不要**勾選 "Add a README file"（我們已有本地專案）。
4. 點 **Create repository**。
5. 建立後，畫面上會顯示 **Quick setup**；先不要照著做，下一步在 VS Code / Cursor 用「遠端 + Push」完成。

### 1.4 將程式碼 Push 到 GitHub

1. 在 VS Code / Cursor 的 Source Control 裡，點 **Publish Branch**（或右上角「…」→ **Remote** → **Add Remote** 再 **Push**）。
2. 若出現「Publish to GitHub」：
   - 選擇 **Publish to GitHub**。
   - 選擇 **Public**。
   - 若問 Repository name，輸入你在 1.3 建立的名稱（例如 `sunrise-cafe`）。
   - 完成後會自動設定 `origin` 並 Push。
3. 若沒有「Publish to GitHub」，改用終端機（專案根目錄）：
   ```bash
   git remote add origin https://github.com/你的帳號/你的專案名稱.git
   git branch -M main
   git push -u origin main
   ```
   （網址與專案名稱請改成你在 1.3 建立的 repo。）
4. 到 GitHub 網頁刷新，應能看到所有程式碼。

---

## 二、Vercel 部署

### 2.1 註冊 / 登入 Vercel

1. 前往 [vercel.com](https://vercel.com)。
2. 點 **Sign Up**，選擇 **Continue with GitHub**，依指示授權 Vercel 讀取你的 GitHub 帳號。
3. 登入後會進入 Vercel Dashboard。

### 2.2 匯入 GitHub 專案

1. Dashboard 點 **Add New…** → **Project**。
2. 在 **Import Git Repository** 底下，選你剛 Push 的專案（例如 `sunrise-cafe`）；若沒出現，點 **Configure GitHub App** 調整授權範圍後再試。
3. 點該專案右側 **Import**。
4. **Configure Project** 畫面：
   - **Framework Preset**：應自動偵測為 Next.js，不需改。
   - **Root Directory**：維持空白（專案在 repo 根目錄）。
   - **Build and Output Settings**：維持預設即可。
5. **最重要：先不要點 Deploy**，先設定環境變數（下一步）。

### 2.3 設定 Environment Variables（環境變數）

1. 在 **Configure Project** 頁面找到 **Environment Variables** 區塊。
2. 新增三筆變數（Name / Value 成對，每筆新增後可再補下一筆）：

   | Name                            | Value                                           | 說明                   |
   | ------------------------------- | ----------------------------------------------- | ---------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`      | 你 .env.local 裡的 `NEXT_PUBLIC_SUPABASE_URL`   | 前端與 API 連 Supabase 用 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 你 .env.local 裡的 `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 前端與 API 用 anon key |
   | `SUPABASE_SERVICE_ROLE_KEY`     | 你 .env.local 裡的 `SUPABASE_SERVICE_ROLE_KEY`  | 後端訂位、時段、我的訂位等 API 用 |

3. 每一筆的 **Environment** 建議三個都勾選：**Production**、**Preview**、**Development**（或至少勾 Production）。
4. 確認三筆都填好且無多餘空白，再點 **Deploy**。
5. 等待建置與部署完成，Vercel 會給你一個網址，例如 `https://sunrise-cafe-xxx.vercel.app`。用瀏覽器開啟即可訪問線上版。

### 2.4 若部署後才要補環境變數

1. 進入 Vercel Dashboard → 點你的專案。
2. 上方 **Settings** → 左側 **Environment Variables**。
3. 新增或編輯變數後，到 **Deployments** 頁，點最新一次部署右側 **…** → **Redeploy**，才會套用新變數。

---

## 三、後續維護：如何把 Cursor 的修改更新到線上網站

流程就是：**本機 Commit → Push 到 GitHub → Vercel 自動重新建置並上線**。

### 3.1 在 Cursor 裡 Commit

1. 改完程式碼後，左側 **Source Control**（`Ctrl+Shift+G`）。
2. 會看到「已變更的檔案」清單；確認要上線的都有勾選（或全選）。
3. 在 **Message** 輸入這次修改的簡短說明，例如：`修正訂位成功頁顯示`、`新增儀表板連結`。
4. 點 **Commit**（只會寫入本機 Git，尚未上傳）。

### 3.2 Push 到 GitHub

1. Commit 後，點 Source Control 上方的 **Sync Changes**（或 **Push**），或終端機執行：
   ```bash
   git push
   ```
2. 若第一次 Push 要登入 GitHub，依視窗指示完成驗證。
3. Push 成功後，GitHub 上的專案已是最新程式碼。

### 3.3 Vercel 自動更新

- Vercel 已和你的 GitHub 專案連動；**每次 `main` 分支有新的 Push**，Vercel 會自動觸發一次新的建置與部署。
- 到 Vercel Dashboard → **Deployments** 可看到每次部署狀態；完成後線上網址就是新版本，無需手動按鈕。

### 3.4 簡短流程整理

```
在 Cursor 改程式碼
  → Source Control：寫 Commit Message → Commit
  → Sync Changes / Push
  → Vercel 自動建置並更新線上網站
```

---

## 注意事項

- **絕對不要** 把 `.env.local` 的內容 commit 或 push；機密只放在本機與 Vercel 環境變數。
- 若 Supabase 專案有暫停（免費方案閒置會暫停），部署後網站連不到資料庫時，請到 Supabase Dashboard 先恢復專案。
- 自訂網域（例如 `booking.yourdomain.com`）可在 Vercel 專案 **Settings → Domains** 設定。

完成以上步驟後，其他人即可透過 Vercel 提供的網址訪問「昇咖啡訂位系統」，且不依賴你的電腦開機。
