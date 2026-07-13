# AI-company 參考評估與採用決策

**參考來源：** [CronusL-1141/AI-company](https://github.com/CronusL-1141/AI-company)（AI Team OS）  
**評估日期：** 2026-07-13  
**決策：** 採用**輕量模式**，不引入完整 Python/FastAPI/React 堆疊

---

## 1. 兩套系統對照

| 維度 | AI-company | Sunrise Cafe（既有） |
|------|------------|---------------------|
| 執行環境 | Claude Code + MCP + PostgreSQL | Cursor Cloud Agent + bash orchestrator + GitHub |
| 任務來源 | `task_create` MCP → DB task wall | `orchestrator/task-catalog.json` + discover |
| 優先排序 | LoopEngine 純規則評分 | `prioritize.sh` jq 評分 |
| 自主迴圈 | CEO loop + hooks | `loop.sh` + `autonomous-loop.yml` |
| 角色 | 25+ agent 模板 | 8 個 `orchestrator/roles/*.md` |
| 失敗學習 | Failure Alchemy → team memory | **新增** `failure-learnings.jsonl` |
| 停滯偵測 | taskwall staleness + watchdog | **新增** `stall-check.sh` |
| 儀表板 | React Decision Cockpit | `/admin/executive` + **新增** task wall API |
| 會議 / 辯論 | 8 種會議模板 | 不需要（單 agent + PR review） |
| 成本 | CC 訂閱內 | Vercel + Supabase 免費層 |

**結論：** 我們已有 80% 的「自主公司」骨架（discover → prioritize → execute → verify → record）。AI-company 的價值在**任務牆可視化**、**失敗煉金**、**停滯告警**——這三項可用 bash + JSON 移植，無需整套 OS。

---

## 2. 已採用（本 PR）

### 2.1 Task Wall（任務牆）

- **腳本：** `scripts/orchestrator/task-wall.sh`
- **輸出：** `orchestrator/task-wall.json`
- **命令：** `npm run cto:task-wall`
- **API：** `GET /api/admin/orchestrator`（`ops:read`）
- **UI：** Executive Dashboard § Engineering Task Wall

對應 AI-company 的 `taskwall_view` / `get_task_wall`，但資料來源是我們的 `priority.json` + `state.json`。

### 2.2 Failure Alchemy（失敗煉金）

- **腳本：** `scripts/orchestrator/failure-alchemy.sh`
- **觸發：** `evidence.sh` 在 phase 含 `fail|blocked|timeout` 時自動呼叫
- **輸出：** `orchestrator/failure-learnings.jsonl`（antibody / vaccine / catalyst）

無 LLM 依賴；規則模板對應常見 loop 失敗（CI、validation、PR 權限等）。

### 2.3 Stall Check（停滯偵測）

- **腳本：** `scripts/orchestrator/stall-check.sh`
- **輸出：** `orchestrator/stall.json`
- **命令：** `npm run cto:stall-check`
- **條件：** 72h 無完成迭代、pending PR 卡住、同 phase 失敗重複 3 次、過期 lease

對應 AI-company 的 deadlock detection / taskwall staleness warning。

### 2.4 編排整合

- `npm run cto:orchestrator` 結尾自動跑 stall-check + task-wall
- Executive API 聚合 task wall + learnings 供決策

---

## 3. 刻意不採用

| AI-company 功能 | 原因 |
|-----------------|------|
| 完整 MCP 工具鏈（108 tools） | Cursor 已有 MCP；重複建設 |
| PostgreSQL + Redis 後端 | 增加營運負擔；JSON/git 已足夠 |
| React Dashboard 獨立部署 | 併入現有 `/admin/executive` |
| 25 agent 模板 | 我們 8 role playbooks 已對齊業務 |
| 會議 / 辯論系統 | PR + adversarial-review 已覆蓋 |
| Claude Code hooks | 平台不同；用 GHA + bash 等價 |
| Workflow swimlane UI | 過度；evidence.jsonl 已可追溯 |
| Ecosystem 研究平台 | 本 repo 已有 discover-work + capability gaps |

---

## 4. 未來可選（P2）

1. **Pre-task vaccine 注入** — 執行 novel task 前把相關 `failure-learnings.jsonl` 摘要寫入 `novel_prompt`
2. **Trust scoring** — 對 handler 成功率加權 `base_score`（需更多 iteration 資料）
3. **Error budget** — 連續 N 次 loop 失敗後自動降級為 doc-only 任務
4. **Reference graph** — 在 ORCHESTRATOR_LOG 交叉連結 PR/issue/wf_id

---

## 5. 使用方式

```bash
# 完整規劃（含 task wall 更新）
npm run cto:orchestrator

# 僅任務牆
npm run cto:task-wall

# 停滯檢查（exit 1 = 有警告）
npm run cto:stall-check

# Admin API
curl -b admin_session=... https://sunrise-cafe-six.vercel.app/api/admin/orchestrator
```

---

## 6. 相關文件

- [`ORCHESTRATOR.md`](./ORCHESTRATOR.md) — 主 SSOT
- [`AUTONOMY_AUDIT.md`](./AUTONOMY_AUDIT.md) — 無人值守證明
- [`CTO_OS_V2.md`](./CTO_OS_V2.md) — 公司級節奏
