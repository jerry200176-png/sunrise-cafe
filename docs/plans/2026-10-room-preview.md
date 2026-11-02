# 訂位頁包廂立體示意：設計

## 問題與現況
客人在選擇包廂時需要理解空間；現有卡片支援照片，後台已有大安店平面圖與 three.js 場景。搜尋 `room`, `image_url`, `floor-plan`, `3D`, 訂位頁、後台與 open PR；重用照片、平面圖尺寸和既有 three.js 依賴。已核對網站上五間包廂的照片，以及 Founder 提供的會議室兩個角度：小包廂有兩側綠色長沙發、中間木桌；會議室有長桌、黑色座椅、窗戶和螢幕。平面圖的部分尺寸是推算值，照片看不到的角落仍只能近似。

## 方案
在訂位卡片外提供可展開、按需載入的立體示意，使用大安店平面圖中明確名稱匹配的包廂；保留照片、訂位及候補入口。名稱無法確定對應時不猜測。依照片和近似尺寸以 Blender 製作五個輕量 GLB；未確認的角落不聲稱是實景。另一方案是 Lux3D 擬真生成：目前執行工具與報價不可用，先以可編修的本機模型前進。另一方案是只顯示照片：已具備，但無法旋轉觀察。

## 架構與 UX
無資料庫、API、付款或訂位規則變更。延用 `floor-plan.ts` 中分店及房名，僅採明確匹配，不採後台自動配對。每次只顯示一個按需載入的 three.js 場景；無 WebGL、載入失敗時顯示說明，失敗的模型可重試，訂位卡片仍可使用。可用鍵盤開合，手機可旋轉，提供繁中、英文及日文。模型由 `scripts/generate-room-previews.py` 重建，尺寸需與 `floor-plan.ts` 保持同步。

## 驗收與上線
匹配的每間包廂可開合並顯示對應示意；其他分店及不匹配名稱不顯示虛構空間；訂位和候補流程不變。驗證匹配、載入與錯誤狀態、手機及桌面訂位流程、現有測試、lint 和 build。按既有 PR／CI／部署流程；回滾程式即可，無資料遷移。觀察既有訂位漏斗及使用者回饋；不新增追蹤。

## 參考做法
- [OpenTable 包廂資訊](https://help.opentable.com/s/article/privatedining)：將照片與容量放在選擇空間時參考。
- [model-viewer 載入範例](https://modelviewer.dev/examples/loading/)（[Apache-2.0](https://github.com/google/model-viewer/blob/master/LICENSE)）：借鑑按需載入與保留後備畫面，不新增依賴。
- 現有後台 `RoomFloorScene.tsx` 及 `floor-plan.ts`：使用既有平面配置、按需繪製與控制。
- [React Three Fiber](https://github.com/pmndrs/react-three-fiber)（MIT）：沿用現有 React／three.js 整合，不複製外部素材。
- 根因：客人缺少可理解空間配置的資訊；卡片沒有示意只是症狀。實景精度需現場資料，示意不替代實景核對。

## 會議室電視位置修正
依使用者提供的畫面與更正，原始模型生成器把螢幕放在會議室左端；根因是示意模型對方位的假設與現場不符。沿用既有 Blender 房間與整店組裝腳本，將螢幕移到右端，採剖面牆並稍微朝向室內，讓訂位頁預設角度仍能看到；其他包廂模型不重新產生。此為可辨識方位的示意，仍以現場照片為準。替代方案是完整右牆，但測試視角會遮住螢幕；另一方案是只修改整店 GLB，但會使房間模型及重建腳本不一致。

參考 [Blender glTF 匯出文件](https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html)，保留 GLB 模型及既有 Three.js 預覽；上方 OpenTable 與 model-viewer 參考繼續適用。驗證重新匯出後兩個模型的螢幕位置、整店示意與照片入口；回復本次模型和生成器變更即可。
