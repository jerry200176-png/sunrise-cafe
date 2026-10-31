# 後台桌位、包廂及分店設定授權修補

## 問題與根因
後台 middleware 只檢查已登入，桌位、週期訂位及部分分店／包廂／設定寫入 API 直接以 service role 查寫，未執行既有 RBAC 角色及分店限制。本機使用合成 session 和假資料確認，受限帳號可對其他分店讀取桌位 QR 或觸發寫入；未對正式站做越權試探。已登入帳號亦可讀取所有分店內部欄位。分店設定 PATCH 未指定 `current_branch_id` 時亦錯誤清空原值。

## 現有功能及方案
搜尋所有相關 handlers、`admin-api-auth.ts`、`rbac.ts`、`docs/RBAC.md` 與現有訂單 API，複用 `requirePermission`；桌位依既有 `orders:read/write` 檢查角色及分店，QR 先取得分店並授權後才讀 token。週期訂位使用現有 `reservations:write` 與分店限制。分店、包廂與設定寫入使用現有 `branches:write`、`rooms:write`、`settings:write`，既定只有 owner。分店清單依帳號限制，對非 owner 只回工作必要欄位，保留訂位訊息使用的匯款資訊；匿名公開清單不變。設定只更新有傳入的欄位，明確 null 仍可清除。只靠 middleware 無法實施角色及資源範圍；不新增角色政策、第三方權限框架或資料庫遷移。

## 驗收及回滾
模擬 session 與 fake client 測試匿名、finance/staff/manager、跨店、owner、QR 資料不洩漏及拒絕寫入；驗證未指定設定欄位不變。執行專案測試、建置、CI 與正式版本/健康檢查。若需回滾，回退 PR；RBAC 安全修補需另行評估，不能以停用權限檢查替代。後台載入可靠性改進另由同工作持續處理。

## 參考做法
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)：每次存取在伺服器端依使用者、操作及資源檢查，預設拒絕。
- 既有訂單 API 以 `requirePermission` 限制操作與分店；沿用本專案的 helper、角色矩陣與回應格式，不引入新依賴。
