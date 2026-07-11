#!/usr/bin/env bash
# Shared helpers for AI Engineering Orchestrator modules

orchestrator_root() {
  cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
}

orchestrator_now() {
  TZ=Asia/Taipei date '+%Y-%m-%d %H:%M %Z'
}

orchestrator_now_iso() {
  TZ=Asia/Taipei date '+%Y-%m-%dT%H:%M:%S%z'
}

orchestrator_short_sha() {
  git rev-parse --short HEAD 2>/dev/null || echo unknown
}

orchestrator_log() {
  echo "[orchestrator] $*"
}

orchestrator_require_jq() {
  command -v jq >/dev/null 2>&1 || {
    echo "jq is required for orchestrator modules" >&2
    exit 1
  }
}
