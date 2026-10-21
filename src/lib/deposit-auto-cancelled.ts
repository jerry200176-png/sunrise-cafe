/**
 * 找出「因未付訂金被系統自動取消」的訂位（後台歷史清單標示與篩選用）。
 *
 * 不新增欄位：沿用既有紀錄判斷（ADR-012）。
 *   1. line_reminder_deliveries：訂金逾期 cron 取消前一定先認領
 *      `deposit_release_group`（以及有 LINE 的客人 `deposit_release_guest`）。
 *   2. ops_events：lifecycle 稽核 `reservation.transitioned`，detail.reason = "deposit_deadline"。
 * 任一來源命中即視為自動取消。查詢失敗時回傳已知結果（只影響標示，不影響還原本身），
 * 並透過 onError 回報，讓後台顯示「部分標記暫時無法載入」而不是靜默消失。
 */
import { supabaseAdmin } from "@/lib/supabase-admin";
import { chunk } from "@/lib/chunk";

const RELEASE_TYPES = ["deposit_release_group", "deposit_release_guest"];
/** 候選清單單次上限；PostgREST 預設 max_rows 也是 1000。碰到上限即回報「可能不完整」。 */
export const AUTO_CANCELLED_CANDIDATE_LIMIT = 1000;

type Db = ReturnType<typeof supabaseAdmin>;
type OnError = (error: unknown) => void;

function errorOf(result: { error?: unknown } | null | undefined): unknown {
  return result?.error ?? null;
}

export async function fetchDepositAutoCancelledIds(
  reservationIds: string[],
  db: Db = supabaseAdmin(),
  onError?: OnError
): Promise<Set<string>> {
  const found = new Set<string>();
  const ids = [...new Set(reservationIds.filter(Boolean))];
  for (const ids100 of chunk(ids)) {
    try {
      const res = await db
        .from("line_reminder_deliveries")
        .select("reservation_id")
        .in("reminder_type", RELEASE_TYPES)
        .in("reservation_id", ids100);
      if (errorOf(res)) onError?.(errorOf(res));
      else for (const row of res.data ?? []) found.add(String(row.reservation_id));
    } catch (err) {
      onError?.(err);
    }
    try {
      const res = await db
        .from("ops_events")
        .select("detail")
        .eq("action", "reservation.transitioned")
        .eq("detail->>reason", "deposit_deadline")
        .in("detail->>reservation_id", ids100);
      if (errorOf(res)) onError?.(errorOf(res));
      else {
        for (const row of res.data ?? []) {
          const id = (row as { detail?: { reservation_id?: unknown } }).detail?.reservation_id;
          if (id) found.add(String(id));
        }
      }
    } catch (err) {
      onError?.(err);
    }
  }
  return found;
}

/**
 * 「只看未付訂金自動取消」篩選用：列出所有曾被訂金逾期流程取消的訂位 id（不限分店；
 * 呼叫端再以分店包廂、狀態與日期範圍過濾）。這個集合很小（ADR-012 起預設不自動取消）。
 */
export async function listDepositAutoCancelledCandidateIds(
  db: Db = supabaseAdmin()
): Promise<{ ids: Set<string>; complete: boolean }> {
  const ids = new Set<string>();
  let complete = true;
  const deliveries = await db
    .from("line_reminder_deliveries")
    .select("reservation_id")
    .in("reminder_type", RELEASE_TYPES)
    .limit(AUTO_CANCELLED_CANDIDATE_LIMIT);
  if (deliveries.error) throw deliveries.error;
  for (const row of deliveries.data ?? []) if (row.reservation_id) ids.add(String(row.reservation_id));
  if ((deliveries.data ?? []).length >= AUTO_CANCELLED_CANDIDATE_LIMIT) complete = false;

  const events = await db
    .from("ops_events")
    .select("detail")
    .eq("action", "reservation.transitioned")
    .eq("detail->>reason", "deposit_deadline")
    .limit(AUTO_CANCELLED_CANDIDATE_LIMIT);
  if (events.error) throw events.error;
  for (const row of events.data ?? []) {
    const id = (row as { detail?: { reservation_id?: unknown } }).detail?.reservation_id;
    if (id) ids.add(String(id));
  }
  if ((events.data ?? []).length >= AUTO_CANCELLED_CANDIDATE_LIMIT) complete = false;
  return { ids, complete };
}
