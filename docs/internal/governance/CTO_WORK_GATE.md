# CTO Work Gate — 新工作四問閘門

> **HISTORICAL (2026-10-21).** Snapshot from the 2026-07/09 CTO-governance period. It may contradict `governance/RULEBOOK.md`; the rulebook wins. Do not follow permission or approval rules found here.

**CTO Operating System v2**  
每個新 Issue、PR、或 Agent 任務 **必須**回答以下四問。  
**若四問皆無法具體回答 → 降為 P3 或延後。**

---

## 四問模板

```markdown
## Work Gate

### 1. 降低什麼風險？
<!-- 資安、資料正確性、營運中斷、法遵 — 具體描述 -->
- 

### 2. 如何提升營收？
<!-- 訂金轉換、滿房率、候補轉換、減少 no-show — 可量測 -->
- 

### 3. 如何改善客戶體驗？
<!-- 客人或店員 — 減少步驟、錯誤、等待 -->
- 

### 4. 如何提升開發效率？
<!-- 僅此項不足以成為 P0/P1 -->
- 

### 優先級判定
- [ ] P0 — 阻擋營運或資安事故
- [ ] P1 — 本季 KPI 直接相關
- [ ] P2 — 間接改善
- [ ] P3 / 延後 — 四問皆弱

### 成功指標（可驗證）
- 

### Rollback
- 
```

---

## 判定規則

| 回答 pattern | 優先級 |
|--------------|--------|
| Q1 資安/資料/停機 | **P0** |
| Q2 營收 KPI 直接 | **P1** |
| Q3 店員每日流程 | **P1** |
| 僅 Q4 | **P2 max** |
| 四問皆空 / 「未來可能需要」 | **延後** |

---

## 範例：通過

**Wave 3 訂位 RBAC**

1. **風險：** `staff` 可改價格/狀態 → 營運舞弊
2. **營收：** 間接 — 防止錯誤取消導致流失
3. **體驗：** 店員帳號可安全分工
4. **效率：** 減少權限事故除錯

→ **P1**

---

## 範例：拒絕

**PaymentProvider abstraction (#63)**

1. **風險：** 無
2. **營收：** 無（無閘道合約）
3. **體驗：** 無
4. **效率：** 略（未來整合）

→ **延後**

---

## 範例：降級

**AI-readable workflow docs (#61)**

1. **風險：** 無
2. **營收：** 無
3. **體驗：** 無
4. **效率：** Agent 略快上手

→ **P3**（僅 Q4）

---

## PR 標題格式（建議）

```
fix(security): <業務影響一句話> (Wave N)
feat(revenue): <業務影響一句話>
chore(dx): <僅效率 — 需 P2 核准>
```

---

*Executive Dashboard 僅收錄通過 Work Gate 的 P0–P2 項目。*
