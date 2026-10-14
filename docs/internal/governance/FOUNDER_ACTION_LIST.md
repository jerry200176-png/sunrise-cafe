# Founder Action List

**Updated:** 2026-10-15 00:09 CST  
**Gate:** PASS · Overall **90** / 100  
**SSOT:** [`FOUNDER_PERMISSIONS.md`](./FOUNDER_PERMISSIONS.md) — 權限與 secret 清單（目標分數 100）

---

## 目前阻塞（自動偵測）

| 項目 | 現況 | 解法 |
|------|------|------|
| Production SHA | `235dd66` vs prod — see drift check | Founder: `vercel deploy --prod` 或提供 `VERCEL_TOKEN` |
| OUTCOME_LOG | 已填 | 設定 `CTO_OUTCOME_SECRET` → 自動同步；或手動開 Executive 儀表板 |
| DB migrations | 3 pending | [`OPS_MIGRATION_RUNBOOK.md`](./OPS_MIGRATION_RUNBOOK.md) |
| Open issues | 0 | 策略性保留 #53/#54/#95/#99；#61/#63 已登記 CAPABILITY_GAPS |

## GitHub 狀態（本輪）

| 指標 | 值 |
|------|---:|
| Open PRs (non-dep) | 0 |
| Draft PRs | 0 |
| cursor/* branches | 0 |
| Bot can close issues | yes |

## 一鍵指令

```bash
# 關閉已 triage 的 issue（若 workflow 未跑）
gh workflow run github-hygiene.yml

# 治理重算
npm run cto:governance
npm run cto:health
```

---

_完整權限清單與「開了能加幾分」見 [`FOUNDER_PERMISSIONS.md`](./FOUNDER_PERMISSIONS.md)._
