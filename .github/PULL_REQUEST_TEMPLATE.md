## 這個 PR 做了什麼

<!-- 一兩句說清楚 — 必須能回答業務影響 -->

## Work Gate（CTO OS v2 必填）

> 模板：[`docs/CTO_WORK_GATE.md`](../docs/CTO_WORK_GATE.md) · 四問皆弱 → 降級或延後

1. **降低什麼風險？**
2. **如何提升營收？**
3. **如何改善客戶體驗？**
4. **如何提升開發效率？**

**優先級：** P0 / P1 / P2 / P3

## 類型

- [ ] feat（新功能）
- [ ] fix（Bug 修復）
- [ ] chore（設定/依賴調整，不影響功能）
- [ ] docs（文件）

## 測試確認

- [ ] 本機 `npm run build` 通過
- [ ] 本機測試過主要功能正常
- [ ] 如果改了 LINE 相關：測試 token 和 webhook 正常
- [ ] 如果改了資料庫：migration SQL 已執行，type 已更新

## 需要同步更新的地方

- [ ] Vercel 環境變數
- [ ] CHANGELOG.md
- [ ] 文件（docs/）
