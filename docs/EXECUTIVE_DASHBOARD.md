# Executive Dashboard — Sunrise Systems

**CTO Operating System v2 · 單一真實來源（SSOT）**  
**最後更新：** 2026-07-11 Round 7（Inbox → Decision → MDU）  
**Production：** https://sunrise-cafe-six.vercel.app · `v2.2.0` · `60bae19`

> **每輪必讀：** [`EXECUTIVE_INBOX.md`](./EXECUTIVE_INBOX.md) → [`DECISION_LOG.md`](./DECISION_LOG.md) → 本文件  
> 技術事實：`IMPLEMENTATION_TRUTH.md` · 健康度公式：`HEALTH_SCORES.md` · `npm run cto:health`

---

## 0. Executive Inbox（本輪審查摘要）

**審查時間：** 2026-07-11 09:45 UTC

| 嚴重度 | 數量 | 最高優先信號 |
|--------|------|--------------|
| 🔴 Critical | 2 | INB-001 migrations 未套用；INB-002 Dependabot Next 16 |
| 🟠 High | 3 | INB-003 幽靈 PR；INB-004 Next CVE（MDU #88 修復中） |
| 🟡 Medium | 3 | KPI 未量測、Cron 成功率未知 |

**決策：** 見 DL-008 — 拒絕 #64/#65，改 controlled security patch (#88)

---

## 1. Executive Summary（30 秒）

| 指標 | 狀態 |
|------|------|
| **平台能否營運？** | 🟢 health ok · CI 10/10 · 129 tests |
| **能否安全聘請員工？** | 🟢 RBAC 完整（#85–#82） |
| **能否多分店？** | 🟡 程式就緒；**3 migrations 待套用** |
| **最大業務風險** | INB-001 schema drift · INB-003 幽靈 PR |
| **本輪 MDU** | #88 Next 15.5.20 security patch + Inbox/Health 系統 |

---

## 2. 健康度計分卡（計算值 — `npm run cto:health`）

| 維度 | 分數 | 目標 | 證據 |
|------|------:|-----:|------|
| **Production stability** | **97** | 95 | health=1 · sha match · ci 10/10 · tests=129 |
| **Security** | **94** | 95 | RBAC ✅ · audit post-#88: crit=0 high=0 |
| **Product quality** | **85** | 90 | Implementation Truth checklist |
| **Customer experience** | **55** | 85 | migrations pending −20 |
| **Revenue reliability** | **70** | 90 | KPIs 未量測 |
| **Developer experience** | **100** | 85 | CI + SSOT + snapshot + health script |
| **GitHub governance** | **52** | 90 | open=10 · draft=7 · dep=2 |
| **整體** | **82** | 90 | weighted per HEALTH_SCORES.md |

> 分數由 `scripts/cto-health-scores.sh` 計算，非人工估計。

---

## 3. 營運 KPI

| KPI | 目標 | 量測 | 現況 |
|-----|------|------|------|
| 訂位完成率 | ≥70% | `analytics_events` | 📊 未自動化 |
| 訂金收取率 | ≥85% | `reservations` | 📊 未自動化 |
| Cron 成功率 | ≥99% | Vercel logs | 🟡 告警已上線，成功率未追蹤 |
| 系統可用性 | 99.5% | health endpoint | 🟢 |

---

## 4. Production & Deployment

| 信號 | 狀態 | 證據 |
|------|------|------|
| Production SHA | 🟢 | `60bae19` = main |
| Health | 🟢 | `{"ok":true}` |
| CI main | 🟢 | 10/10 success |
| Cron alerting | 🟢 | #87 merged |
| DB parity | 🔴 | 3 migrations pending |

---

## 5. GitHub 治理

| PR | 判定 | 動作 |
|----|------|------|
| #88 | Security patch Next 15.5.20 | **合併** |
| #64, #65 | Next 16 — **拒絕** (DL-008) | Founder 關閉 |
| #70–#77 | 零價值幽靈 | Founder 關閉 |
| #69–#87 | Merged | ✅ |

---

## 6. Business Impact Queue（Inbox 重排後）

| Rank | 工作 | 狀態 | 決策 |
|------|------|------|------|
| 1 | 套用 3 migrations | 🔴 Ops | INB-001 — blocked, tracked |
| 2 | 關閉幽靈 PR + 拒絕 #64/#65 | 🟠 Founder | INB-002/003 |
| 3 | **#88 Security deps** | 🟢 Eng | DL-008 本輪 MDU |
| 4 | #53 付款流程優化 | P1 | DL-009 下一輪 |
| 5 | Cron 成功率量測 | P2 | INB-006 |
| 6 | #59 E2E 擴充 | P2 | 品質 |

---

## 7. 風險登錄簿（未關閉 = 持續追蹤）

| ID | 風險 | 嚴重度 | 緩解 | 負責 | 狀態 |
|----|------|--------|------|------|------|
| R-001 | Migration 未套用 | 🔴 | Ops 套用 SQL | Ops | **OPEN** |
| R-002 | 幽靈 PR 混淆決策 | 🟠 | Founder 關閉 | Founder | **OPEN** |
| R-003 | Dependabot major jump | 🟠 | #88 + dependabot.yml ignore | Eng | **MITIGATING** |
| R-004 | KPI 盲飛 | 🟡 | insights 自動化 | Product | **OPEN** |
| R-005 | Cron 成功率未知 | 🟡 | job_runs 表 | Eng | **OPEN** |

---

## 8. 每日快照

```
日期：2026-07-11
Production SHA：60bae19
Open PRs：10（7 draft）
Open Issues：7
CI main：10/10 green
Tests：129
Overall health：82 (calculated)
Blockers：R-001, R-002 (manual)
本輪 MDU：#88 security patch
```

---

## 9. 文件階層

```
docs/EXECUTIVE_INBOX.md     ← 每輪起點（信號收集）
docs/DECISION_LOG.md        ← 優先級決策紀錄
docs/EXECUTIVE_DASHBOARD.md ← 本文件（營運狀態）
docs/HEALTH_SCORES.md       ← 分數公式
docs/IMPLEMENTATION_TRUTH.md
```

---

*Round 7 · Inbox reviewed · DL-008 logged · MDU #88 executing.*
