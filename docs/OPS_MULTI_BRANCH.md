# 多分店開店 Playbook

**適用：** 昇昇咖啡第二店及後續分店  
**前置：** 主店（大安店）已穩定運行

---

## 1. 分店資料（後台 → 分店管理，不需直接改 Supabase）

1. 新增分店：`名稱`、`對客顯示名稱`（例：昇昇咖啡 (信義店)，也用於 LINE 卡片）、地址、電話、營業時間
2. `LINE 群組 ID`、`匯款資訊`、`LINE Pay 連結`
3. 選填，**只有這間店和全站設定不同時才填**（留空＝沿用「設定」頁的全站內容）：
   - 此店 Google 評論連結（結帳後的評論邀請）
   - 此店訂金說明（訂位表單顯示）
   - 此店租借注意事項（每段第一行是標題，下面每行一個項目，段落間空一行；客人需勾選同意）
4. 新增包廂並設定平日／假日時價、人數、照片
5. 營業時間：不同天不同時間或每週固定公休 → 勾「依星期設定營業時間」，逐日設定或勾「公休」（客人選到公休的星期會看到本日公休）
6. 特定日期公休（國定假日等）：「公休日設定」選該分店後設定
7. 菜單：菜單管理選該分店建立

欄位來源：`branches` 表（覆寫欄位由 `migration-branch-guest-settings.sql` 新增，走 predeploy 自動套用）。

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
