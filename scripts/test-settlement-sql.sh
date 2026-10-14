#!/usr/bin/env bash
# 在「拋棄式本機 PostgreSQL」上跑結帳／退款 SQL 情境測試。絕對不要指向 Supabase 或任何正式資料庫。
#
#   PGHOST=/var/run/postgresql PGPORT=5432 PGUSER=postgres bash scripts/test-settlement-sql.sh
#
# 會建立一個全新的暫時資料庫（settlement_test_<pid>），跑完就刪掉：
#   1) supabase/tests/settlement-fixture.sql        模擬正式環境的表
#   2) supabase/migration-reservation-settlements.sql（套用兩次，確認可重複執行）
#   3) supabase/tests/refund-ledger.test.sql         退款原則 1–5 的情境
#   4) 下面的同時操作情境（兩個連線搶同一筆訂位）
set -euo pipefail

host="${PGHOST:-}"
case "$host" in
  ""|/*|localhost|127.0.0.1|::1) ;;
  *) echo "拒絕執行：PGHOST=$host 不是本機（只允許 unix socket 或 localhost）" >&2; exit 2 ;;
esac

root="$(cd "$(dirname "$0")/.." && pwd)"
db="settlement_test_$$"
psql_admin() { psql -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }
run() { psql -X -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }

psql_admin -c "CREATE DATABASE $db"
trap 'psql_admin -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null 2>&1 || true' EXIT

run -f "$root/supabase/tests/settlement-fixture.sql"
run -f "$root/supabase/migration-reservation-settlements.sql" 2>/dev/null
run -f "$root/supabase/migration-reservation-settlements.sql" 2>/dev/null
echo "ok - migration applies twice"
run -f "$root/supabase/tests/refund-ledger.test.sql" 2>&1 | grep -E "^(psql:.*)?(NOTICE:  )?ok - |PASSED|FAIL|ERROR" | sed -E 's/^psql:[^ ]+ NOTICE:  //; s/^NOTICE:  //'

# ---------------------------------------------------------------------------
# 同時操作：A 開 transaction 做第一件事並停 2 秒；B 在 A 還沒 commit 時做第二件事，必須等 A 的鎖
# ---------------------------------------------------------------------------
race() {  # $1 標題  $2 A 的 SQL  $3 B 的 SQL  $4 B 預期錯誤（空字串 = 預期成功）  $5 驗證 SQL（回 t）
  local label="$1" res out_b
  res="$(run -tA -c "SELECT t.mk()")"
  run -c "BEGIN; ${2//:r/$res}; SELECT pg_sleep(2); COMMIT;" >/dev/null &
  local pid=$!
  sleep 0.5
  if out_b="$(run -tA -c "${3//:r/$res}" 2>&1)"; then
    [ -z "$4" ] || { echo "FAIL: $label (B 應該失敗：$4)"; exit 1; }
  else
    [ -n "$4" ] && grep -q "$4" <<<"$out_b" || { echo "FAIL: $label (B: $out_b)"; exit 1; }
  fi
  wait "$pid"
  [ "$(run -tA -c "${5//:r/$res}")" = "t" ] || { echo "FAIL: $label (驗證不成立)"; exit 1; }
  echo "ok - $label"
}

race "P1 concurrent: refund request first → checkout waits, then refuses (refund_in_flight)" \
  "SELECT t.refund(':r', 200, 'race-a-:r')" \
  "SELECT t.settle(':r', 200)" "refund_in_flight" \
  "SELECT NOT EXISTS (SELECT 1 FROM reservation_settlements WHERE reservation_id = ':r')"

race "P1 concurrent: checkout first → refund waits, then finds nothing refundable" \
  "SELECT t.settle(':r', 200)" \
  "SELECT t.refund(':r', NULL, 'race-b-:r')" "nothing_to_refund" \
  "SELECT (SELECT deposit_credit FROM reservation_settlements WHERE reservation_id = ':r') = 200
     AND NOT EXISTS (SELECT 1 FROM reservation_refunds WHERE reservation_id = ':r')"

race "P1 concurrent: two terminals check out → one settlement" \
  "SELECT t.settle(':r', 200, 0, 'cash')" \
  "SELECT t.settle(':r', 200, 0, 'card')" "already_settled" \
  "SELECT (SELECT count(*) FROM reservation_settlements WHERE reservation_id = ':r') = 1"

race "P3 concurrent: two full refunds with different keys → only one" \
  "SELECT t.refund(':r', NULL, 'race-c1-:r')" \
  "SELECT t.refund(':r', NULL, 'race-c2-:r')" "nothing_to_refund" \
  "SELECT (SELECT count(*) FROM reservation_refunds WHERE reservation_id = ':r') = 1"

race "P5 concurrent: same idempotency key twice → one refund" \
  "SELECT t.refund(':r', 120, 'race-d-:r')" \
  "SELECT t.refund(':r', 120, 'race-d-:r')" "" \
  "SELECT (SELECT count(*) FROM reservation_refunds WHERE reservation_id = ':r') = 1"

echo "settlement SQL tests: ALL PASSED"

# ---------------------------------------------------------------------------
# 回滾（保留資料）：函式拿掉、資料一列都不少；之後可以再套一次 migration 往前走
# ---------------------------------------------------------------------------
before="$(run -tA -c "SELECT (SELECT count(*) FROM reservation_settlements)||'/'||(SELECT count(*) FROM reservation_extensions)
  ||'/'||(SELECT count(*) FROM reservation_refunds)||'/'||(SELECT count(*) FROM reservation_refund_events)")"
run -f "$root/supabase/rollbacks/reservation-settlements-keep-data.sql" >/dev/null 2>&1
after="$(run -tA -c "SELECT (SELECT count(*) FROM reservation_settlements)||'/'||(SELECT count(*) FROM reservation_extensions)
  ||'/'||(SELECT count(*) FROM reservation_refunds)||'/'||(SELECT count(*) FROM reservation_refund_events)")"
[ "$before" = "$after" ] || { echo "FAIL: rollback lost rows ($before → $after)"; exit 1; }
[ "$(run -tA -c "SELECT count(*) FROM pg_proc WHERE proname IN ('settle_reservation_checkout','extend_reservation_stay',
  'request_reservation_refund','record_reservation_refund_status','sync_provider_refund','reservation_billing_state')")" = "0" ] \
  || { echo "FAIL: rollback left write RPCs"; exit 1; }
run -c "UPDATE reservation_refunds SET amount = 1" >/dev/null 2>&1 && { echo "FAIL: ledger writable after rollback"; exit 1; }
echo "ok - rollback keeps every settlement/extension/refund row ($after) and stays append-only"
run -f "$root/supabase/migration-reservation-settlements.sql" >/dev/null 2>&1
[ "$(run -tA -c "SELECT count(*) FROM pg_proc WHERE proname = 'request_reservation_refund'")" = "1" ] \
  || { echo "FAIL: re-apply after rollback"; exit 1; }
echo "ok - migration re-applies after rollback"
echo "rollback tests: ALL PASSED"
