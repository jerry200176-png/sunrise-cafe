# 產品路線圖（公開）

**更新：** 2026-07-13 · **狀態：** 積極維護中

> 僅列出對外可分享的規劃。內部工程 backlog 見 `docs/internal/automation/ENGINEERING_BACKLOG.md`。

---

## 已完成（v2）

- [x] 包廂線上訂位 + 電話查詢/取消  
- [x] LINE 訂金通知 + 群組營運推播  
- [x] 付款截圖審核後台  
- [x] 訂金逾期自動釋放 + 候補通知  
- [x] 執行儀表板 + North Star KPI  
- [x] 多分店資料模型（LINE 群組 per branch）

---

## Q3 2026 — 營運強化

| 項目 | 說明 | 狀態 |
|------|------|------|
| KPI 自動量測 | 訂金率、漏斗、付款 SLA 寫入 dashboard | 🟢 已部署（需 migration） |
| 付款審核 SLA | 4h 內審核達成率追蹤 | 🟢 已部署 |
| 多分店 LINE | `branches.line_group_id` 完整上線 | 🟡 migration optional |
| 整合收款 #99 | Stripe / LINE Pay 直連 | 📋 規劃中 |

---

## Q4 2026 — 規模化

| 項目 | 說明 |
|------|------|
| 第二店複製 playbook | 標準開店 checklist + 環境模板 |
| 加盟主報表 | 週營收/訂金/取消率 PDF 或郵件 |
| 客人端 UX | Mobile-first 訂位流程優化 |

---

## 不納入近期範圍

- 通用 CRM / 會員點數（超出單店訂位核心）  
- 全自動 AI 接電話訂位（ROI 未證實）

---

## 如何追蹤進度

- GitHub Issues（標籤 `roadmap`）  
- 每月更新本文件  
- 線上 KPI：`/admin/executive`（需後台權限）
