# 產品／技術／商業競爭力審計報告

**日期：** 2026-07-15  
**範圍：** 昇昇咖啡包廂訂位系統（`sunrise-cafe`）  
**生產 URL：** https://sunrise-cafe-six.vercel.app  
**證據基準：** `main` @ `cfc940b`；生產 `GET /api/version` → `commit: cfc940b…`（與 main 對齊）；程式碼／migration／Issues／公開競品資料  
**SSOT 衝突規則：** 以程式碼與 `IMPLEMENTATION_TRUTH.md` 為準，勝過過期 executive 報告

證據標記：
- **[FACT]** 已確認（程式碼／生產／官方文件）
- **[INFER]** 合理推論
- **[HYP]** 尚待驗證假設

---

## A. Executive Summary

### 系統目前整體競爭力

對「LINE 導流、包廂時段出租、人工匯款訂金」的台灣中小包廂咖啡店，本系統已達 **營運可用的客製垂直解（B+ 營運閉環／B− 商用 SaaS 成熟度）**。[FACT] 核心訂位→訂金審核→逾期釋放→候補→明日提醒已上線且生產健康（`/api/booking-health` → `ok:true`）。相較 Inline／OpenTable／SevenRooms，缺的是 **流量網絡、即時金流、店內席次圖、合規退費、可觀測的營運 KPI 閉環**；相較「月費 SaaS」，優勢是 **零抽成、資料自有、包廂／訂金邏輯可客製、工程治理異常完整**。[INFER]

### 最大 3 個優勢

1. **訂金營運閉環深度（包廂垂直）** — 雙 LINE Bot、截圖審核佇列、逾期自動取消、候補遞補、D-1 出席確認，針對「高價時段＋訂金」痛點，比通用桌控系統更貼近本業態。[FACT]
2. **資料與通路自主** — 非 marketplace 抽成；客人自有官網／LINE 下單，無 per-cover 費用。[FACT vs OpenTable/EZTABLE 商業模式]
3. **工程可靠性基礎高於典型 SMB 自建模** — session＋RBAC、重疊約束、CI＋E2E smoke、cron `job_runs`、deploy SHA 核對、Sentry 可選。[FACT]

### 最大 5 個差距

| # | 差距 | 類型 |
|---|------|------|
| 1 | **目錄表 RLS 仍允許 anon 寫入**（branches/rooms/settings）；admin 寫入曾走 anon key | 安全 P0 [FACT] — *本 PR 已修程式；DB migration 待套用* |
| 2 | **訂金仍以人工匯款＋截圖為主**；Stripe 程式在、生產金流未閉環；已付訂金取消需回電 | 營收／CX P1 [FACT] |
| 3 | **North Star 多數仍 unmeasured／pipeline**；缺成效驗證就持續加功能 | 產品決策盲點 P1 [FACT] |
| 4 | **店長後台不如 Inline／TableCheck**（無席次圖即時狀態、批次操作弱、手機場控體驗） | 營運效率 P1 [INFER+FACT] |
| 5 | **Rate limit fail-open、無強契約備份／合規退費政策機** | 可靠性／法規風險 P0–P1 [FACT+HYP] |

### 最值得立即投資的事項

1. 套用 catalog RLS migration＋確認後台 CRUD（本 PR）  
2. Founder：Upstash 啟用＋Supabase 備份策略決定  
3. 量測並凍結 KPI baseline（訂金轉換、審核 SLA、候補轉換）後再決定 #99 金流  
4. 已付訂金取消／退費政策（消保合規）產品化  
5. 後台「本日場控」瘦身（行動優先單一畫面）

### Founder 真正需要決策的項目

見 **H. Founder Decision Queue**（金流上線、Upstash、備份／Pro、退費政策、是否做外部流量合作）。

---

## B. Current System Assessment

### 核心流程（已驗證）

```
客人 /book 選店→日→廂→時段→表單
  → POST /api/reservations（server 計價、重疊檢查）
  → 成功頁／可 LINE bind／可 Stripe modal（需金鑰）
  → 店長確認 → LINE 訂金請求（客人 Bot）
  → 客人傳截圖／文字 → payment_events pending_review
  → /admin/payments 核准 → is_deposit_paid
  → deposit-deadline cron：提醒／急催／逾期取消＋候補
  → 取消／空出 → waitlist 通知
  → 每日 20:00 TW 明日群組提醒
```

[FACT] 生產 SHA 與 main 對齊；booking-health OK。

### 主要角色

| 角色 | 能力 | 認證 |
|------|------|------|
| 客人 | 訂／查／改期／取消（未付）、候補、出席確認 | phone + booking_code |
| 店長／staff／finance／owner | 訂位、付款審核、報表、分店設定 | ADMIN_PASSWORD 或 RBAC email |
| 廚房／吧台 | QR 點餐、print-bridge | 店內本機 |
| 系統／Cron | 提醒、訂金截止、deploy-health | CRON_SECRET |

### 架構與運作方式

Next.js 15（Vercel）＋ Supabase ＋ LINE 雙 Channel ＋ 可選 Stripe／Upstash／Sentry；print-bridge 店內。Cron 於 `vercel.json`（含 Hobby 限制下 deposit-deadline 每 6h）。[FACT]

### 目前產品成熟度

| 維度 | 評級 | 說明 |
|------|------|------|
| 客人訂位主路徑 | B+ | 半點開場、skeleton、逾時處理近期強化 |
| 訂金營運 | B | 審核閉環完整；金流與退費未閉 |
| 後台場控 | C+ | 功能齊但 monolith、非 Inline 級即時席管 |
| 多店 | B− | 模型有；line_group_id migration 仍 optional |
| 觀測／KPI | C | API 有、數字常空 |
| 安全邊界 | B−→B | API 硬、DB RLS 目錄曾漏（本次收斂） |
| 工程流程 | A− | 文件／orchestrator 過重，可能掩蓋產品焦點 [INFER] |

### 關鍵風險

1. **anon 可寫目錄**（修補前）→ 竄改價格／閉店日／匯款資訊 [FACT]  
2. **Upstash 未設 → rate limit 無效** [FACT]  
3. **消保退費**：文案「已付不可退」與市場合規標竿衝突風險 [HYP 法律]  
4. **Stripe 半完成**：配置錯易造成「看起來能付、實際失敗」信任損傷 [INFER]  
5. **文件漂移**：歷史報告宣稱 P0 未修，實際已合 → 決策噪音 [FACT]

### 「已實作但不好用／未閉環／使用者無感」

| 現象 | 證據 |
|------|------|
| Stripe 訂金 UI／API | 程式在；ROADMAP 仍「規劃中」；需 STRIPE_* [FACT] |
| Executive North Star | 指標 registry 多為 unmeasured／pipeline [FACT] |
| 點餐／print-bridge | 衛星能力；非每日訂位痛點主線 [INFER] |
| Orchestrator／CTO 儀表 | 工程治理熱、客／店長感受弱 [INFER] |
| 已付取消 | API 強制來電；與 i18n「non-refundable」敘事耦合 [FACT] |
| CSV 對帳 MVP | 有 API；ROI 未以審核工時驗證 [HYP] |

---

## C. Commercial Benchmark

### 標竿產品（6）

| 產品 | 類型 | 選擇原因 | 證據來源 |
|------|------|----------|----------|
| **Inline** | 台／亞桌控 SaaS | 直接競品、包廂／訂金／LINE、店內 iPad | [inline.app](https://inline.app/)、[inline.company](https://inline.company/)、Google Cloud case（7k+ 店） |
| **EZTABLE** | 台平台＋訂位 | 消費者流量網絡對照 | [eztable.com](https://eztable.com/)、Damazy 費用整理 |
| **Eatsy** | 台中小用量計費 | 同客群定價對照 | [partners.eatsy.tech 2026 比較](https://partners.eatsy.tech/en/blog/comparison-matrix-eatsy-inline-oddle-ichef-eztable-vibeai-2026) |
| **OpenTable** | 國際平台 | 候位／訂金／席管／網絡成熟度天花板 | OpenTable restaurant-solutions 官網 |
| **TableCheck** | 亞太直連 SaaS | 預付、多通路匯總、CRM、API | [tablecheck.com](https://www.tablecheck.com/en/join/) |
| **SevenRooms** | 國際 CRM＋直連 | 預付／行銷自動化／客人終身價值 | [sevenrooms.com](https://sevenrooms.com/pricing/) |

### 關鍵能力比較（摘要）

| 能力 | 本系統 | Inline | EZTABLE | Eatsy | OpenTable | TableCheck | SevenRooms |
|------|--------|--------|---------|-------|-----------|------------|------------|
| 自有品牌訂位頁 | ✅ | ✅ | △（平台為主） | ✅ | ✅ | ✅ | ✅ |
| 消費者流量網絡 | ❌ | 強 | 很強 | 弱 | 很強 | 中 | 中（marketplace add-on） |
| LINE 雙向營運 | ✅ 深 | ✅ | ✅ | 有限 | 弱（SMS） | SMS/多管道 | WhatsApp 等 |
| 包廂／時段計價 | ✅ 強 | ✅ | △ | △ | 桌為主 | ✅ | ✅ 活動／包場 |
| 訂金：人工審核 | ✅ | △ | △ | ✅ 合規政策 | 卡／deposit | 卡預付 | 卡／預付 |
| 訂金：自動金流 | 🟡 Stripe 未閉 | ✅ 卡 | ✅ | ✅ | ✅ | ✅ PCI | ✅ |
| 逾期釋放＋候補 | ✅ | ✅ 候位 | ✅ | ✅ | ✅ 強 | ✅ | ✅ |
| 席次圖／場控 | ❌ | ✅ 核心 | △ | △ | ✅ | ✅ | ✅ |
| RBAC／稽核 | 🟡 RBAC；稽核表設計未落地 | ✅ | ✅ | △ | ✅ | ✅ MFA | ✅ |
| 報表決策 | 🟡 基礎＋executive | ✅ | ✅ | △ | ✅ | ✅ | ✅ 強 CRM |
| 定價模式 | 自建成本 | 月費 ~1–2.5k | 月費+抽成 | ~NT$3–5/筆 | 封面費/訂閱 | ~US$250+/月起 | ~US$499+/月 |
| Onboarding | 工程部署 | 商業導入 | 業務 | 7 日試用 | 業務 | 業務 | 業務 |

費用為公開／第三方彙整，**以各官網報價為準**。[FACT 模式／INFER 精確數字]

### 不該抄的能力

| 能力 | 為何不抄 |
|------|----------|
| Marketplace 消費者 App | 本店靠 LINE／熟客；建流量網絡成本失控 |
| POS 雙向深度整合 | 核心是包廂時段非翻桌 POS；#print 已夠用 |
| SevenRooms 級行銷自動化 | 客量與客單不足以吃滿 US$500+/月價值 |
| AI 接電話訂位 | ROADMAP 已列 ROI 未證；維持 |
| 多語完整產品化（英日） | Issue 曾開；非現階段轉換瓶頸 [INFER] |

---

## D. Gap Matrix

| 領域 | 本系統現況 | 標竿做法 | 差距 | 使用者影響 | 商業影響 | 優先級 | 成本 | 建議行動 |
|------|------------|----------|------|------------|----------|--------|------|----------|
| DB 授權邊界 | reservations 已硬；**catalog anon FOR ALL**（修補前）；寫入走 anon | deny-by-default RLS | 公開 anon key 可改價／匯款資訊 | 信任崩潰 | 高 | **P0** | S | 本 PR：service role 寫入＋migration |
| Admin context 腳槍 | 無效 cookie 曾回傳 owner | 失敗＝零權限 | 誤用 API 可能提權 | 低（多數有前置 auth） | 中 | **P0** | S | 本 PR：`deniedContext` |
| 訂金金流 | 截圖審核；Stripe 半套 | Inline/Eatsy/OT 線上付 | 審核 SLA、漏單、人工 | 付訂摩擦 | 收入／人力 | **P1** | L | KPI 後再開 #99；勿批發抄 |
| 退費／消保 | 已付需來電；文案偏不可退 | Eatsy 分層退費政策 | 合規與客訴風險 | 糾紛 | 法規 | **P0/P1** | M | Founder 定政策→產品化 |
| KPI 閉環 | Registry 有、觀測空 | Stripe/OT 儀表驅動迭代 | 不知道優化什麼 | 無感功能堆積 | 浪費工程 | **P1** | S | 強制 weekly outcomes |
| Rate limit | Upstash fail-open | 一律Enforce | 查詢／爆破風險 | 濫用 | 穩定性 | **P0** | S（設定） | Founder 設環境變數 |
| 後台場控 | 列表＋大頁 | Inline 桌圖＋遠端監看 | 高峰值班效率 | 店長累 | 人力 | **P1** | M | 「今日時程」單頁 MVP |
| 備份／DR | Free 方案風險（停／無 PITR） | Pro＋備份 | 資料遺失 | 災難 | 存續 | **P0** | $ | Founder 升 Pro 或外部備份 |
| 付款稽核表 | 設計稿；僅 log | 可查詢 audit | 爭議難追溯 | 糾紛處理慢 | 風險 | **P2** | M | Phase B migration |
| CRM／回訪 | review invite 片段 | SevenRooms CRM | 回購工具弱 | 熟客無感 | LTV | **P3** | L | 量測後再說 |
| 多語 | 部分 i18n | OT 等多語 | 外客 | 小 | 小 | **P3** | M | 暫緩 |
| 文件／治理噪音 | 極多 internal docs | 精簡 SSOT | 決策失真 | 間接 | 工程浪費 | **P2** | S | 凍結過期報告、只更 Truth |

成本：S≤1–2 人日 · M≈3–7 · L≥2 週或依賴外部。

---

## E. Top 5 Strategic Improvements（ROI 排序）

### 1. 關閉公開目錄寫入面（RLS + service-role 寫入）— **本 PR**

| 項 | 內容 |
|----|------|
| 為什麼現在 | anon key 在客戶端暴露；FOR ALL 等於公開改價／匯款帳號 |
| 不做成本 | 惡意或誤用可直接破壞營運資料 |
| 預期成果 | 目錄突變僅經認證 API＋service role |
| 成功指標 | anon `POST/PATCH` branches → 失敗；後台 CRUD 仍成功；CI 綠 |
| 執行步驟 | ① 程式改 adminHeaders ② deploy ③ 執行 `migration-rls-catalog-read-only.sql` ④ 驗證 |
| 驗收 | 見下方 Verification；`TRACKED_MIGRATIONS` 含新版 |
| 工作量 | S |
| 依賴／風險 | **必須先 deploy 程式再跑 migration**，否則後台寫入會 401/403 |
| 自主執行 | ✅ 程式＋migration 檔；套用 DB 需憑證／Founder |

### 2. 啟用 Rate Limit + 確認 Session／備份底線

| 項 | 內容 |
|----|------|
| 為什麼現在 | fail-open＝防護形同未裝；客人查詢可被刷 |
| 不做 | 成本攻擊、資料嗅探機率上升 |
| 成果 | 登入／lookup／booking 有硬上限 |
| 指標 | Upstash 儀表有拒絕對數；`guest.lookup_denied_rate_limit` 出現於濫用測試 |
| 步驟 | Vercel 設 UPSTASH_*；可選 SESSION_SECRET 分離；Supabase 備份決策 |
| 工作量 | S（設定）+ $ |
| 自主 | ❌ 需 Founder 帳密／付費 |

### 3. KPI Baseline 強制落地（再談功能）

| 項 | 內容 |
|----|------|
| 為什麼現在 | 無數字→市場對齊功能 ROI 無法證明 |
| 不做 | 繼續「感覺在進步」 |
| 成果 | `/admin/executive` 訂金率／審核 SLA／候補轉換有 30 日基線 |
| 指標 | 三指標連續 14 日有 Observed；週檢 `executive:review` |
| 步驟 | 確認 ops-events／payment_events 資料完整→店長每週看一次 |
| 工作量 | S |
| 自主 | ✅ 儀表已存在；需營運紀律 |

### 4. 訂金政策產品化（取消／退費／通話降載）

| 項 | 內容 |
|----|------|
| 為什麼現在 | 標竿（Eatsy）強調消保分層；來電取消佔人力 |
| 不做 | 客訴＋可能法規；尖峰電話塞車 |
| 成果 | 明確窗期（如 48h 可申請退）＋後台一鍵標記退費狀態 |
| 指標 | 已付取消來電比例 ↓30%；爭議單可稽核 |
| 步驟 | Founder 簽政策→文案／API 對齊→可选手動退費流程（非自動 Stripe） |
| 工作量 | M |
| 自主 | 政策 ❌；實作可在政策後 ✅ |

### 5. 後台「今日場控」行動單頁（非席次圖大工程）

| 項 | 內容 |
|----|------|
| 為什麼現在 | 店長高頻任務：誰未付、誰快到、候補待打 |
| 不做 | 繼續在多頁與 LINE 群切換 |
| 成果 | 一屏完成 80% 值班決策（對齊 Inline「遠端監看」的 20% 能力） |
| 指標 | 付款審核中位時間；店長回報切頁次數（質化可先） |
| 步驟 | 聚合 dashboard/payments/waitlist 今日切片；不做完整 floor plan |
| 工作量 | M |
| 自主 | ✅ |

---

## F. 30 / 60 / 90 Day Roadmap

### 30 天 — 風險收斂

- [x] Catalog RLS 程式硬化（本 PR）  
- [ ] 生產執行 RLS migration（Founder/Ops）  
- [ ] Upstash 啟用驗證  
- [ ] Supabase 備份／Pro 決策  
- [ ] KPI 三指標連續量測  
- [ ] 凍結過期 ENGINEERING_ASSESSMENT 敘事，只維護 IMPLEMENTATION_TRUTH  

### 60 天 — 核心流程與工程

- [ ] 訂金取消／退費政策上線（文案＋後台狀態）  
- [ ] 今日場控單頁 MVP  
- [ ] payment_audit_log Phase B（若爭議 ≥N/月）  
- [ ] Stripe／LINE Pay go-live **僅當** 訂金轉換 < 目標或審核人力不足  
- [ ] E2E：`E2E_ADMIN_PASSWORD` 打通付款審核路徑  

### 90 天 — 可持續優勢

- [ ] 第二店複製 playbook（環境模板＋分店 LINE）  
- [ ] 合規訂金政策成為對加盟／評估簡報賣點  
- [ ] 精簡 orchestrator 噪音：自主循環只服務 P0–P1  
- [ ] 評估是否需要極窄「席次時間軸」而非完整桌圖  

---

## G. Metrics

| 指標 | Baseline（現況） | 30 日目標 | 來源 |
|------|------------------|-----------|------|
| 訂位完成率（進流程→建立） | unmeasured [FACT] | ≥65% 或先有數字 | ops-log / booking-funnel |
| 訂位完成時間中位 | unmeasured | <5 min | funnel timestamps |
| 訂金轉換率（30d） | pipeline | ≥85% | north-star API |
| 付款審核 SLA（≤4h） | pipeline | ≥90% | payment_events |
| 候補轉換 | pipeline | ≥30% | waitlist |
| 取消率（30d） | pipeline | <15% | reservations |
| 已付取消來電比率 | 未知 [HYP] | 建基線後 −30% | 人工／tag |
| Cron 失敗率（7d） | job_runs | <1% | job_runs |
| 部署 SHA 漂移天數 | 曾有 gap；現對齊 [FACT] | 0 持續 | `/api/version` |
| 缺陷逃逸（prod hotfix／週） | 未系統記 | 下降趨勢 | GitHub＋incident |
| Rate-limit 拒絕對數 | 0（未 enforce） | >0 under test | Upstash |
| LCP p75 | unmeasured | <2.5s | RUM |

---

## H. Founder Decision Queue

| ID | 決策 | 為何需要你 | 建議預設 |
|----|------|------------|----------|
| FD-1 | **是否升級 Supabase Pro／開備份** | 付費＋資料存續 | 開自動備份至少 |
| FD-2 | **是否設定 Upstash Redis** | 環境密鑰 | 是（低成本） |
| FD-3 | **生產執行 RLS catalog migration 時點** | 不可逆權限收緊；需確認後台 | merge 本 PR 並驗證後立即 |
| FD-4 | **已付訂金取消／退費政策**（表格） | 法律／客體感／收入權衡 | 分層：≥48h 可申請退；以內來電審核 |
| FD-5 | **Q3 是否正式開 Stripe／LINE Pay** | 金流合約、手續費、客服話術 | **先看 KPI 兩週**；人力痛再開 |
| FD-6 | **是否導入外部流量（EZTABLE/Inline 雙掛）** | 抽成 vs 曝光 | 預設否（熟客 LINE 為主） |

非決策（Agent 可繼續）：場控 UI、文件漂移清理、稽核表實作、測試補強。

---

## 系統性問題（跨發現）

1. **防禦深度不均**：API 中層強、DB 邊界鬆、邊緣保護（rate limit）可關。  
2. **「治理劇場」風險**：文件／orchestrator 密度＞客／店長可感知價值。  
3. **半成品金流**：增加複雜度但未關營收環。  
4. **指標債務**：North Star 定義完整、餵數不足→無法殺功能。  
5. **工作arounds**：已付取消通話、付款回 LINE 截圖、無 LINE 候補改人工撥打——系統邊緣仍靠真人膠水。

---

## 本輪已落地變更（程式）

見同 PR：

- `supabase-fetch` 寫入改 service role  
- `migration-rls-catalog-read-only.sql` + `rls-policies.sql` 對齊  
- `getAdminContext` → `deniedContext`  
- `headersAdmin` 禁止 anon fallback  
- 測試＋`PAYMENT_STATE_MODEL` Phase 2 文件糾偏  
- `TRACKED_MIGRATIONS` 納入臨界 migration  

**驗證計畫：** `npm test`；merge 後生產套用 SQL；以 anon key 嘗試 PATCH branches 應失敗；後台改分店名稱應成功。
