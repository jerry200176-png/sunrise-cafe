# 後台訂位清單欄位收斂（#434 部分）

- 根因：列表查詢以 `*` 取得訂位，再把整列展開回傳；未來新增的資料庫工作欄位也會進入瀏覽器。症狀是清單含有畫面無需使用的資料；目前沒有證據顯示越權或正式資料遭外洩。
- 範圍：新版 ReservationList 明確請求 `list_contract=v2`，回應使用明確清單保留付款資訊、取消標記及預點摘要所需欄位，LINE 綁定只返回布林值。舊分頁與未知 caller 沒有此參數，仍取得舊回應；因此不能宣稱舊 caller 已不接收識別碼。新版遇舊伺服器時可讀舊欄位，缺欄位時顯示無法確認。原分店授權、分頁、搜尋、補充查詢及資料庫寫入不變。
- 參考做法：Supabase [關聯與欄位查詢](https://supabase.com/docs/guides/database/joins-and-nesting) 與 [PostgREST 資源表示](https://postgrest.org/en/stable/references/api/resource_representation.html)（PostgREST 為 MIT 授權）支援選取明確欄位，讓 API 契約不跟著整列成長。本修改自行實作回應投影，未複製程式碼。
- 取捨：資料庫查詢暫留 `*`，因現有程式須相容歷史可選欄位；改成固定 select 前需要確認所有正式 schema 與其他統計呼叫者。此修改不減少 DB 到伺服器的讀取量，也不改 realtime 訂閱的資料。外部未知 API caller 仍保留舊回應，其後續遷移未驗證。
- 驗證：以合成資料核對列表、付款及巢狀摘要的欄位和未來欄位排除；原 branch scope 和分頁測試保留。上線前依 D2–D8 走 CI、獨立複核與發布驗證；原需求的查詢欄位投影及實機驗證未完成，不關閉 #434。
