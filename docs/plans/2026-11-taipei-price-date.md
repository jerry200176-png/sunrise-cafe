# 依台北日期判斷既有平假日價格

基準 `e55ffb4792ee37dc94b2c45cb8ce3d2168a90f7e`；只修既有週六、週日價格規則的日期判斷，不改費率、付款政策或歷史訂位金額，不執行 SQL。

## 根因與現況

搜尋 `isWeekendDate`、`computeReservationTotalPrice`、訂位／候位、結帳與改期。客頁用日曆日期計預覽，`isWeekendDate` 卻把未含時區的中午解讀為裝置當地時間，再轉台北日期；海外時區可能跨日。一般訂位與候位確認另直接截取 timestamp 字串前十字元；UTC 與台北午夜日期不同時可能選錯費率。結帳讀 API 回傳的帳單，服務端 `computeCheckoutBill` 從 instant 取得台北日期後仍呼叫相同的日曆日期判斷；SQL 權威結帳函式在台北時區判斷起始日。兩種日期來源不應互換。

例：合成台北週六 01:00 的 UTC 是前一天週五 17:00。平日每小時 200、週末 300、兩小時，舊客頁 600 而 UTC 伺服器建立 400。實際營業時段、正式資料與是否有人受影響未核實。客頁時區 America/Los_Angeles 的週五、週日亦可分別誤判成週末與平日。本次沒有批次改寫已保存的訂位或已發通知；共用函式也影響後台新增／編輯與週期新增的未來價格顯示／計算，以及下述尚在使用的舊資料 fallback。

## 範圍與輸入契約

純日期代表已選的台北日曆日，按 `YYYY-MM-DD` 的年/月/日計算星期，不依裝置時區。已知呼叫方為 HTML date、週期訂位日期及結帳的台北日期；舊函式對完全無效的日期回 false（平日），保留布林形狀，對無效日期不新增價格或錯誤處置規則。時間戳按 `Date` 解析後的 instant 轉 Asia/Taipei；產品建立訂位送出 `toISOString()`，資料庫 timestamptz 回傳包含 offset；對原本接受而未帶 offset 的其他呼叫暫不擴大 API 驗證範圍，其解讀仍依執行環境。使用 `Intl.DateTimeFormat.formatToParts` 明確取 Gregorian 數字，避免依 en-CA 字串格式組裝日期。

修一般訂位的伺服器總價、候位確認日期來源，並沿用相同台北日期規則於結帳。客頁選好時段後以該時段實際台北起始日計價及標記平假日；尚未選時段則以所選日曆日預估，避免跨午夜營業的隔日時段仍使用前一天價格。不批次修改已儲存 total_price 或延長紀錄，也不變更金額演算法；但若 settlement schema 缺失，原有結帳舊路徑仍依現有時數及現行費率計價，日期修正可能改變歷史訂位的即時顯示應收，不能保證所有歷史應收不變。lifecycle 改期不自動重算 total_price，但後台編輯表單允許員工套用本次修正後的估算或手動修改再儲存；本次不改其政策。`payment-request-line.ts` 中既有歷史 null total_price fallback 另有字串截取並可能寫回，因本次不更動付款及歷史金額，保持原樣並列為未解限制；共用純日期函式修正會影響其星期判斷。週期訂位的日期推進與其他時區處理未納入本次。

隔離合成比較：假設計算程式執行在 `America/Los_Angeles`、台北週五 10:00 開始兩小時、平日 200／小時、假日 300／小時、沒有已付訂金或餐費。舊程式錯將週五判為假日：extension schema 缺失時，即使預訂 total_price 已存 400，畫面應收也按現價從舊的 600 變為修正後 400；schema 存在但 total_price 為 null 時，依現價估算的應收同樣由 600 變 400；schema 存在且已存 total_price 400、延長費為 0 時，應收保持 400。這是兩個獨立執行時區的合成結果，不代表正式伺服器使用此時區、正式資料有此狀況或已更改任何紀錄。

## 參考做法

- [MDN Intl.DateTimeFormat.formatToParts](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/formatToParts)：以指定時區與欄位取得日期，而非依語系產生字串的外觀。
- [PostgreSQL AT TIME ZONE](https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-ZONECONVERT)：既有 settlement SQL 已以 Asia/Taipei 判斷 isodow；本次不執行或修改 SQL。
- [date-fns](https://github.com/date-fns/date-fns)（MIT）：原生 Date 較易與本機時區交錯；參考明確傳達日期與時區的原則，不新增依賴或複製程式。
- 根因是把日期與 instant 混用，而非費率設定；統一把 instant 轉成台北日期，並將純日期視為日曆值。

## 驗證、限制與回復

以合成資料測 UTC、台北、洛杉磯及跨日 offset；週五、週六、週日與週一邊界；跨午夜時長、候位確認、已記價格、延長費紀錄與舊資料；無效輸入保留既有錯誤路徑。確認未更改改期儲存及付款邏輯。CI、獨立審核和瀏覽器驗證依發布程序另做；回復程式碼不能自動修正已建立的訂位，不執行歷史更改。
