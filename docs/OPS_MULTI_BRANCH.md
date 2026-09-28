# 多分店開店 Playbook

**適用：** 昇昇咖啡第二店及後續分店  
**前置：** 主店（大安店）已穩定運行

---

## 1. 資料庫

1. 在 Supabase 新增 `branches` 列：
   - `name`, `slug`, `display_name`
   - `payment_info`, `line_pay_url`（訂金話術用）
   - `line_group_id`（該店 LINE 群組 ID）
2. 新增 `rooms` 列並設定時段定價
3. 確認 `migration-branches-line-group-id.sql` 已套用（若使用 DB 欄位而非 env fallback）

---

## 2. LINE

| 項目 | 動作 |
|------|------|
| 群組 Bot | 在新店群組設定 `line_group_id` |
| 客人 Bot | 共用既有客人 OA（話術依 `display_name` 自動帶入） |
| Webhook | 同一 URL：`/api/webhooks/line` |
| 明日提醒 Cron | 自動對所有有 `line_group_id` 的分店推播 |

---

## 3. Vercel 環境

不需新 deployment — 同一 app 多分店。確認：

- `SUPABASE_*` 指向正確專案  
- `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CUSTOMER_ACCESS_TOKEN`  
- `CRON_SECRET`（Cron 認證）  
- 可移除 `LINE_GROUP_ID` env fallback（當所有店都用 DB 欄位）

---

## 4. 店內印單機（print-bridge）

每間店的電腦各跑一份 `print-bridge/`，並在該份 `print-bridge/.env` 設定：

```
BRANCH_ID=<此店 branches.id>
```

未設定時會列印**所有分店**的點餐單（單店時的舊行為）。第二間店開張前，**大安店的電腦也要補上 `BRANCH_ID`**，否則新店的單會印在大安店廚房。

---

## 5. 店長 onboarding（首日）

1. 後台登入 → 確認新分店出現在訂位/報表  
2. 測試一筆訂位 → LINE 群組收到「新訂位申請」  
3. 測試付款截圖審核 → `/admin/payments`  
4. 閱讀 [`OPS_PAYMENT_SOP.md`](./OPS_PAYMENT_SOP.md)

---

## 6. 驗收清單

- [ ] 客人可選新店包廂並完成訂位  
- [ ] 群組收到新訂位 + 付款確認通知  
- [ ] 明日提醒推播到**新店群組**（非舊店）
- [ ] 新店點餐單只在新店印表機印出（大安店不會印）  
- [ ] `/admin/executive` 訂金率含新店資料  
- [ ] `GET /api/booking-health` 回傳 ok

---

## 7. 常見問題

**Q：兩店共用 Supabase 會互相影響嗎？**  
A：不會。訂位以 `branch_id` / `room_id` 隔離；提醒 Cron 依 `line_group_id` 分群推播。

**Q：何時需要獨立 Vercel project？**  
A：僅在品牌/網域完全獨立時。同一品牌多店建議維持單一 deployment。
