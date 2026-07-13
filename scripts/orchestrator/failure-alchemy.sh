#!/usr/bin/env bash
# Failure alchemy — distill learnings from loop failures (AI-company pattern, no LLM)
# Usage: failure-alchemy.sh <phase> <task_id> [json_payload]
# Output: append to orchestrator/failure-learnings.jsonl

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"
orchestrator_require_jq
orchestrator_root

PHASE="${1:-unknown}"
TASK_ID="${2:-unknown}"
PAYLOAD="${3:-\{\}}"
FILE="orchestrator/failure-learnings.jsonl"
mkdir -p orchestrator

# Map failure phases to defensive rules (antibody) and process hints (catalyst)
case "$PHASE" in
  ci_fail|ci_timeout)
    ANTIBODY="合併前確認 gh pr checks 全綠；CI 失敗時先跑 npm test && npm run lint locally"
    CATALYST="考慮擴充 ci-fix.sh 安全修復範圍或降低 novel task 複雜度"
    ;;
  validation_fail)
    ANTIBODY="execute 後必須 npm test 通過；novel task 應附 verify 腳本"
    CATALYST="task-catalog verify 欄位應可機械執行"
    ;;
  execute_fail|execute_degraded)
    ANTIBODY="任務需有 handler 或 codex-agent 支援；新增任務先寫 handler stub"
    CATALYST="discovered-work 應附 novel_prompt 與 handler 路徑"
    ;;
  pr_create_blocked|push_blocked)
    ANTIBODY="GHA token 權限不足時 persist pending_pr 並 exit 2，勿重複 push"
    CATALYST="founder 批次授權或 resume 路徑見 loop.sh §4"
    ;;
  review_fail|adversarial_fail)
    ANTIBODY="合併前 review.sh + adversarial-review.sh 必須通過"
    CATALYST="縮小 MDU diff 或拆分任務"
    ;;
  *)
    ANTIBODY="檢查 orchestrator/autonomy-evidence.jsonl 最後幾行定位根因"
    CATALYST="若同 phase 重複出現，考慮調低任務 base_score 或標記 blocked"
    ;;
esac

VACCINE="## 失敗案例：${TASK_ID}
- Phase: ${PHASE}
- 任務：${TASK_ID}
- 預防：${ANTIBODY}
- 詳情：見 autonomy-evidence.jsonl phase=${PHASE}"

jq -c -n \
  --arg ts "$(orchestrator_now_iso)" \
  --arg phase "$PHASE" \
  --arg task "$TASK_ID" \
  --arg antibody "$ANTIBODY" \
  --arg vaccine "$VACCINE" \
  --arg catalyst "$CATALYST" \
  --arg sha "$(orchestrator_short_sha)" \
  --argjson data "$PAYLOAD" \
  '{
    ts: $ts,
    type: "failure_alchemy",
    phase: $phase,
    task_id: $task,
    sha: $sha,
    antibody: $antibody,
    vaccine: $vaccine,
    catalyst: $catalyst,
    data: $data
  }' >> "$FILE"

echo "failure-alchemy: $PHASE ($TASK_ID)"
