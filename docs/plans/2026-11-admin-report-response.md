# 後台報表回應錯誤處理

## 根因與範圍
報表頁將成功 HTTP 回應直接當成既定型別；TypeScript 型別不會驗證網路資料。當服務回傳 200 但 JSON 缺少報表欄位時，頁面 render 的 `by_hour.map` 等操作會拋錯，使用者失去報表和重試入口。這是合成回應可重現的程式缺口，並未確認它是正式站實際載入失敗的原因。

## 作法
沿用既有 `fetchWithTimeout`、`readJsonWithTimeout` 和請求序列檢查，在設定 state 前驗證頁面及 CSV 所用欄位（包含有效空陣列及可為 null 的收款率）；無法辨識的回應顯示錯誤和手動重試，並移除舊資料與匯出入口，避免把過時報表當成最新結果。這不更改授權、資料庫、金額計算或自動重送寫入。未引入新的驗證套件或改寫其他頁面；其他頁面若有類似格式問題仍需分別檢查。

## 參考做法
- [Next.js 錯誤處理](https://nextjs.org/docs/app/getting-started/error-handling)：預期中的錯誤應轉換為可由使用者恢復的狀態；非同步資料錯誤不應依賴 render error boundary。
- [SWR 錯誤處理](https://swr.vercel.app/docs/error-handling)（[MIT 授權](https://github.com/vercel/swr/blob/main/LICENSE)）：將錯誤與資料狀態區分，提供重試；本案沿用已有工具，不引入整套資料取得框架。
- 根因是網路邊界缺少 runtime 結構驗證；白畫面只是症狀。此修正驗證頁面實際消費欄位，不假定其他端點已受保護。
