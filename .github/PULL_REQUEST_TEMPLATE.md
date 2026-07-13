## 關聯 Issue

Closes #<!-- issue-number (若無請填「無」) -->

## 變更摘要

<!-- 簡述改了什麼、為什麼。對客人/店長/營運有什麼影響？ -->

## 技術細節

<!-- 實作方式、架構決策、注意事項、參考 docs/ 或 ADR -->

## 測試清單

- [ ] `npm test` 通過
- [ ] `npm run build` 通過
- [ ] 單元測試已新增/更新
- [ ] E2E 測試（若適用）
- [ ] 手動測試完成
- [ ] 若改 LINE：token / webhook 正常（雙 channel 對照 CLAUDE.md）
- [ ] 若改 DB：migration SQL 已加入 `supabase/`
- [ ] 若改 Cron：確認時區轉換（UTC 12:00 = TW 20:00）

## 資安審查

- [ ] 無敏感資料暴露（API key、token、密碼）
- [ ] API 權限檢查完整（RLS / RBAC）
- [ ] 輸入驗證與 sanitization

## 文件更新

- [ ] `CHANGELOG.md`（使用者可見變更）
- [ ] API 或環境變數有變動時更新 `docs/`
- [ ] `CLAUDE.md`（AI 工作手冊，若架構/流程有變）

## UI 變更（截圖）

<!-- 有 UI 變更時貼圖說明；無則刪除此區塊 -->

## 部署注意事項

- [ ] 需執行 migration（對應 `supabase/` SQL）
- [ ] 需設定/更新環境變數（Vercel 需 Redeploy）
- [ ] 需更新 Stripe Webhook endpoint
- [ ] 需更新 print-bridge（若列印流程有變）

---

### Reviewer Checklist

Reviewer 審查時確認：

- [ ] 程式碼符合專案風格（ESLint / TypeScript）
- [ ] 邊界情況已處理
- [ ] 錯誤處理完整（含 API error status code）
- [ ] 無明顯效能問題（N+1 query、不必要的 re-render）
- [ ] 符合 [Code Review 指南](../docs/code-review-guide.md)
