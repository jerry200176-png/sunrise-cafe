# 系統架構

## 整體架構

```
客人瀏覽器                  管理者瀏覽器
    │                           │
    └──────────┬────────────────┘
               │ HTTPS
         ┌─────▼──────┐
         │   Vercel    │  Next.js 15 App Router
         │  (Serverless│  - /app → 前台訂位/點餐
         │   + Cron)   │  - /admin → 後台管理
         └──────┬──────┘
                │
        ┌───────┼──────────┐
        ▼       ▼          ▼
   Supabase  LINE API   Resend
  (Database) (通知推播)  (備用 email)

店內電腦
  └── print-bridge (Node.js)
        └── Star 熱感印表機
```

## 模組說明

### 前台（客人）
| 路徑 | 功能 |
|------|------|
| `/` | 首頁導覽 |
| `/book` | 訂位流程（選分店→包廂→時段→填資料） |
| `/book/query` | 以電話查詢/取消訂位 |
| `/book/success` | 訂位成功、LINE 綁定引導 |
| `/order/[tableToken]` | 自助點餐（QR 掃碼進入） |

### 後台（管理者）
| 路徑 | 功能 |
|------|------|
| `/admin` | 儀表板（今日統計、時間軸） |
| `/admin/login` | 密碼登入 |
| `/admin/tables` | 訂位列表、確認/取消、發送通知 |
| `/admin/menu` | 菜單管理 |
| `/admin/orders` | 點餐訂單管理 |
| `/admin/print-station` | 廚房列印站 |

### API Routes
| 路徑 | 說明 |
|------|------|
| `/api/reservations` | 訂位 CRUD |
| `/api/availability` | 可用時段查詢 |
| `/api/webhooks/line` | LINE Webhook（付款偵測） |
| `/api/admin/reminders/send-line` | 明日提醒（Cron + 手動） |
| `/api/admin/diagnose-line` | LINE token 健康檢查 |

## 資料庫主要資料表

```
branches        分店（大安店等）
  └── rooms     包廂（含定價、圖片、說明）
        └── reservations  訂位記錄
              - status: pending / confirmed / cancelled
              - is_deposit_paid: boolean
              - line_user_id: 綁定客人 LINE ID

settings        全域設定（公休日、訂金說明、付款關鍵字）
menu_categories 菜單分類
  └── menu_items 菜單品項
        └── orders 點餐訂單
```

## LINE 整合流程

```
新訂位建立
  → 自動推播群組通知（群組 Bot）

後台確認訂位
  → 自動 Push 訂金請求給客人（客人 Bot）

客人傳付款關鍵字/截圖
  → Webhook 觸發（群組 Bot channel）
  → 更新 is_deposit_paid = true
  → 群組收到「已付訂金」通知
  → 客人收到確認回覆

每日 20:00（台灣）
  → Vercel Cron 觸發
  → 推播大安店明日訂位清單至群組
  → 無訂位則發送貓咪訊息
  → 有綁定 LINE 的客人各自收到提醒
```

## 部署流程

```
本機修改 → git commit → git push
  → GitHub 觸發 Vercel 自動 build
  → Vercel 部署新版本（約 1-2 分鐘）
```

環境變數只在 Vercel Dashboard 設定，不進 git。
