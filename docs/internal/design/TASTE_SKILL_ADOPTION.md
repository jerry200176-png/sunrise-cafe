# Taste Skill 採用決策

**參考來源：** [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill)  
**評估日期：** 2026-07-24  
**決策：** 安裝 **design-taste-frontend / redesign-existing-projects / high-end-visual-design** 作為 agent skill；視覺以 [`DESIGN.md`](../../../DESIGN.md) 為 SSOT，**不**用 taste-skill 預設 theme 覆蓋品牌。

---

## 1. 裝了什麼

```bash
npx skills add https://github.com/Leonxlnx/taste-skill \
  --skill "design-taste-frontend" \
  --skill "redesign-existing-projects" \
  --skill "high-end-visual-design"
```

本 repo 路徑：

- `.agents/skills/design-taste-frontend`
- `.agents/skills/redesign-existing-projects`
- `.agents/skills/high-end-visual-design`
- `.cursor/skills/*`（Cursor 可見複本）

---

## 2. 與昇咖啡的關係

| 能力 | 採用 | 說明 |
|------|------|------|
| redesign audit + anti-slop | ✅ | 對齊既有 `npm run design:audit` / DESIGN.md §11 |
| soft / editorial elevation | ✅ | 在奶油紙 + 焦糖品牌內提升層次、動效、不對稱版面 |
| greenfield 換 palette / 禁奶油紙 | ❌ | 品牌已鎖定 Warm Artisan Editorial；採 **redesign-preserve** |
| 整站換成 Awwwards 實驗風 | ❌ | 訂位流程與客人信任優先 |

**一句話：** Taste Skill 是**品味教練**，不是**換皮工具**。

---

## 3. 本輪已落地（客人首頁）

- Hero 改為 `min-h-[100dvh]` 單一構圖：品牌 → 標語 → CTA
- Logo 去掉白底卡片框；服務說明移出第一視窗
- 三欄等寬 feature 卡 → 不對稱編號列表
- CTA 巢狀箭頭圓、指定 transition 屬性、press scale
- LanguageSwitcher 對齊 `caramel` / `ink` token

## 4. 本輪已落地（後台）

- 新增 `src/components/admin/AdminShell.tsx`：統一 sticky header + 底部場控導覽
- 已接入：`/admin`、`/admin/today`、`/admin/payments`、`/admin/dashboard`、`/admin/waitlist`；登入頁對齊 stone/amber
- 後台首頁改「今日營運」優先 + 「系統工具」列表（不再 8 格等寬 shortcut）
- 其餘頁（orders/menu/tables/…）可逐步遷入同一 shell

後台色票仍依 DESIGN.md：`stone` / `amber`（營運密度優先）。
