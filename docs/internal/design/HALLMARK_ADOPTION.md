# Hallmark 參考評估與採用決策

**參考來源：** [Nutlope/hallmark](https://github.com/Nutlope/hallmark)（Anti-AI-slop design skill）  
**評估日期：** 2026-07-13  
**決策：** 採用 **`audit` 方法論**與 slop 檢查；**不**用預設 theme 生成覆蓋品牌

---

## 1. Hallmark 是什麼

Hallmark 是給 Cursor / Claude Code / Codex 用的 **設計 skill**，核心目標是避免「一眼 AI 味」的 UI：

| Verb | 用途 |
|------|------|
| *(default)* | 從零生成新 UI（選 macrostructure + theme） |
| `hallmark audit` | 對既有程式碼打分、列 punch list，**不改檔** |
| `hallmark redesign` | 保留文案與 IA，換結構重建 |
| `hallmark study` | 從參考設計提取 DNA（非像素複製） |

內建 **58 道 slop-test gate**（Inter 字體、紫藍漸層、三欄 icon 卡、card-in-card、`transition-all` 等）。

---

## 2. 與昇咖啡的關係

我們已有固定品牌：**Warm Artisan Editorial**（[`DESIGN.md`](../../../DESIGN.md)）— 奶油紙、咖啡墨、焦糖 accent、Fraunces + Noto。

| Hallmark 能力 | 能否用 | 說明 |
|---------------|--------|------|
| **audit** | ✅ 推薦 | 檢查 admin / 新頁是否滑向 AI 預設 |
| **slop-test 清單** | ✅ 已精簡併入 DESIGN.md §11 | 與品牌規則對齊的 subset |
| **study** | ⚠️ 選用 | 研究氛圍時可用，但**不得**覆蓋色票與字體 SSOT |
| **default build / 20 themes** | ❌ 不採用 | 會產生 Bubble/Carnival 等與咖啡館無關的 fingerprint |
| **redesign 整站** | ❌ 不採用 | 訂位流程已驗證；大改結構風險高 |

**一句話：** Hallmark 是**品質檢查員**，不是**品牌設計師**。

---

## 3. 已採用（本 repo）

### 3.1 機械稽核腳本

```bash
npm run design:audit          # 掃描 src/ 常見 AI slop pattern
npm run design:audit -- --strict   # 有命中即 exit 1（可接 CI）
```

對應 Hallmark 的 `hallmark audit`，但規則鎖定在**我們品牌已禁止**的項目（見 `scripts/design-slop-audit.sh`）。

### 3.2 DESIGN.md 擴充

[`DESIGN.md`](../../../DESIGN.md) §11 新增 Hallmark-inspired 稽核清單，供 agent 改 UI 前自檢。

### 3.3 可選：安裝上游 skill（本機 Cursor）

若要在 IDE 內用完整 58 gate + `study` / `redesign`：

```bash
npx skills add nutlope/hallmark
```

或將 `skills/hallmark/SKILL.md` 複製到 `.cursor/rules/`。**使用時必須附上 DESIGN.md 約束**：「在 Warm Artisan 品牌內 audit，不得換 theme。」

---

## 4. 目前 codebase 已知命中（示例）

`npm run design:audit` 可能標出（需逐步修）：

- `transition-all` — 客人首頁 CTA、admin 快捷按鈕（應改為 `transition-[transform,box-shadow,border-color]`）
- `peer-checked:bg-blue-600` — `AddReservationForm` toggle（應改 caramel/stone 暖色）
- Admin 仍混用 `amber`/`stone` — 允許（DESIGN.md 已說明後台沿用），但避免冷色 `blue-*`

這些是**修復候選**，不是立刻全改；優先 admin 視覺與客人首頁。

---

## 5. 與其他參考的分工

| 參考 | 角色 |
|------|------|
| [`DESIGN.md`](../../../DESIGN.md) | 品牌 SSOT（色、字、元件） |
| [awesome-design-md](https://github.com/VoltAgent/awesome-design-md) | 文件結構方法論 |
| **Hallmark** | Anti-slop 稽核與 agent 自檢 |
| [AI-company](https://github.com/CronusL-1141/AI-company) | 工程自主運轉（與 UI 無關） |

---

## 6. 建議工作流（Agent / 人）

1. 改 UI 前讀 `DESIGN.md`
2. 改完跑 `npm run design:audit`
3. 大改版前可選 `hallmark audit src/app/admin`（上游 skill）
4. **禁止**在未讀 DESIGN.md 的情況下執行 hallmark default build

---

## 7. 相關指令

| 指令 | 說明 |
|------|------|
| `npm run design:audit` | 本 repo slop 掃描 |
| `npx skills add nutlope/hallmark` | 安裝完整 Hallmark skill（可選） |
