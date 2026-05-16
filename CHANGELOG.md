# Changelog

所有重要變更記錄於此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)，版本號遵循 [Semantic Versioning](https://semver.org/)。

---

## [1.0.0] — 2026-05-09

### Added
- 付款關鍵字可在後台自訂（預設保留，可新增/刪除）
- 問句自動排除：訊息含「嗎」「？」「如何」等不觸發付款偵測

### Fixed
- LINE 群組通知與客人個人通知時間顯示從 UTC 修正為台灣時間（Asia/Taipei）

---

## [0.9.0] — 2026-04-24

### Added
- 訂位表單加入 LINE Login 綁定，提高通知綁定率
- 客人傳圖片自動視為付款截圖，觸發已付訂金標記
- 後台診斷端點（`/api/admin/diagnose-line`）：查詢兩個 token 狀態與本月用量

### Fixed
- 拆分群組 Bot 與客人 Bot 為獨立 LINE channel（`LINE_CHANNEL_ACCESS_TOKEN` vs `LINE_CUSTOMER_ACCESS_TOKEN`）
- 確認訂位時若無金額，自動從房間定價計算，不再卡關
- 重複電話客人自動繼承已綁定的 `line_user_id`
- 付款偵測改為關鍵字比對，避免一般聊天誤觸發群組通知

### Added（付款自動化）
- 後台一鍵手動發送 LINE 繳費通知按鈕
- 客人付款後系統自動標記 `is_deposit_paid`、群組同步收到通知
- 無訂位時群組自動發送貓咪訊息（隨機 5 則）

---

## [0.8.0] — 2026-04-22

### Added
- 後台公休日設定，前台自動封鎖無法訂位
- 包廂訂位最少 2 小時限制

---

## [0.7.0] — 2026-04-17

### Changed
- 所有訂位（平日/假日）均收取訂金（原僅週末/國定假日）

---

## [0.6.0] — 2026-04-01

### Added
- 自助點餐系統：菜單瀏覽、購物車、訂單送出、QR 桌位牌
- 廚房列印站（Star WebPRNT，58mm 熱感紙）
- `print-bridge` 本機列印橋接服務

---

## [0.5.0] — 2026-03-06

### Added
- 訂金追蹤系統（`is_deposit_paid`）
- 訂位查詢頁面顯示匯款方式說明、截圖上傳引導
- 包廂說明同意勾選框、人數範圍設定

### Changed
- 取消政策更新為 48 小時前可取消並退訂金

---

## [0.4.0] — 2026-02-24

### Added
- LINE 明日訂位自動提醒（每日台灣時間 20:00 推播到群組）
- Vercel Cron Job 設定（`vercel.json`）
- 後台儀表板訂位時間軸視圖，標記已通知狀態

---

## [0.3.0] — 2026-02-10

### Fixed
- 時區問題全面修正（Vercel UTC → Asia/Taipei）
- 時段選項改為 0.5 小時間隔

### Improved
- 後台管理 UX 全面優化
- 包廂圖片顯示修正

---

## [0.2.0] — 2026-02-05

### Added
- LINE 群組通知：新訂位、後台確認後自動推播
- 包廂圖片支援（Supabase Storage）
- 訂位狀態預設為 `pending`（需後台確認）
- `/api/version` 部署確認端點

### Fixed
- Next.js 15.1.9 升級（CVE-2025-66478 安全修補）
- 台灣時區可用時段計算修正

---

## [0.1.0] — 2026-02-05

### Added
- 初始版本：昇昇咖啡包廂訂位系統
- 客人端：選分店/包廂/時段、填資料預約、查詢與取消
- 後台：訂位列表、包廂管理、儀表板
- Supabase PostgreSQL + Realtime
- Vercel 部署
