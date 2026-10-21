/**
 * 找出「因未付訂金被系統自動取消」的訂位（後台歷史清單標示與篩選用）。
 *
 * 不新增欄位：沿用既有紀錄判斷（ADR-012）。
 *   1. line_reminder_deliveries：訂金逾期 cron 取消前一定先認領
 *      `deposit_release_group`（以及有 LINE 的客人 `deposit_release_guest`）。
 *   2. ops_events：lifecycle 稽核 `reservation.transitioned`，detail.reason = "deposit_deadline"。
 * 任一來源命中即視為自動取消。查詢失敗時回傳已知結果（fail-open），只影響標示，不影響還原本身。
 */
import { supabaseAdmin } from "@/lib/supabase-admin";

const RELEASE_TYPES = ["deposit_release_group", "deposit_release_guest"];
const CHUNK = 100;

type Db = ReturnType<typeof supabaseAdmin>;

export async function fetchDepositAutoCancelledIds(
  reservationIds: string[],
  db: Db = supabaseAdmin()
): Promise<Set<string>> {
  const found = new Set<string>();
  const ids = [...new Set(reservationIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    try {
      const { data, error } = await db
        .from("line_reminder_deliveries")
        .select("reservation_id")
        .in("reminder_type", RELEASE_TYPES)
        .in("reservation_id", chunk);
      if (!error) for (const row of data ?? []) found.add(String(row.reservation_id));
    } catch {
      /* fail-open: label only */
    }
    try {
      const { data, error } = await db
        .from("ops_events")
        .select("detail")
        .eq("action", "reservation.transitioned")
        .eq("detail->>reason", "deposit_deadline")
        .in("detail->>reservation_id", chunk);
      if (!error) {
        for (const row of data ?? []) {
          const id = (row as { detail?: { reservation_id?: unknown } }).detail?.reservation_id;
          if (id) found.add(String(id));
        }
      }
    } catch {
      /* fail-open: label only */
    }
  }
  return found;
}
