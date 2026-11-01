/**
 * 後台訂位列表（`GET /api/reservations`）的伺服器端範圍、分頁與搜尋。
 *
 * 以前一次撈出分店「有史以來」所有訂位（舊到新、無上限）再在瀏覽器過濾：
 *   - 資料越多越慢、越容易逾時；
 *   - PostgREST max_rows（預設 1000）會截掉「最新」的訂位（因為是舊到新排序）；
 *   - 補充查詢把全部 id 塞進 URL，過長就整批失敗而被吞掉（付款待審標記、預點餐消失）。
 *
 * 現在分兩個範圍（參考 OpenTable / SevenRooms 的「即將到來 / 歷史」與 Stripe Dashboard 的列表分頁）：
 *   - active：所有「未結案」訂位（待確認、已確認、已到店…），不限日期，舊到新。
 *     過期但沒結案的訂位也留在這裡，店員才能補標「沒來／完成」（#469）。
 *     超過上限時優先保留今天以後的訂位，再補最近的過期未結案訂位（截掉的是最舊的過期列）。
 *   - history：已完成／已取消／沒來，預設近 30 天、新到舊，每頁 50 筆，以 (start_time, id) keyset 分頁。
 */
import { supabaseAdmin } from "@/lib/supabase-admin";
import { taipeiDatePlusDays } from "@/lib/datetime";
import { chunk } from "@/lib/chunk";
import { fetchAll } from "@/lib/overview-data";
import { fetchPendingPaymentCountsByReservation } from "@/lib/payment-events-admin";
import { fetchPreorderSummaries } from "@/lib/reservation-preorder";
import {
  fetchDepositAutoCancelledIds,
  listDepositAutoCancelledCandidateIds,
} from "@/lib/deposit-auto-cancelled";

type Db = ReturnType<typeof supabaseAdmin>;

export const RESERVATION_SELECT = "*,room_with_branch:rooms(id,name,branch:branches(name))";
export const HISTORY_STATUSES = ["completed", "cancelled", "no_show"] as const;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
/** active 範圍每批撈的筆數與總上限（未結案訂位正常只有數十到數百筆）。 */
export const ACTIVE_BATCH = 500;
export const ACTIVE_CAP = 2000;
/** 熟客次數查詢每批電話數（電話比 UUID 短，但每支電話可能對到多筆訂位）。 */
const PHONE_CHUNK = 50;

export type ReservationScope = "active" | "history";
export type HistoryRange = "7d" | "30d" | "90d" | "all";
export type HistoryStatusFilter = "all" | "completed" | "cancelled" | "no_show" | "auto_cancelled";

const RANGE_DAYS: Record<Exclude<HistoryRange, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };
const HISTORY_STATUS_FILTERS: HistoryStatusFilter[] = ["all", "completed", "cancelled", "no_show", "auto_cancelled"];

export interface ReservationCursor {
  t: string;
  id: string;
}

export interface ReservationListParams {
  branchId: string;
  scope: ReservationScope;
  range: HistoryRange;
  status: HistoryStatusFilter;
  q: string;
  cursor: ReservationCursor | null;
  limit: number;
  id: string | null;
}

export interface ReservationRow {
  id: string;
  start_time: string;
  status?: string;
  phone?: string | null;
  room_id?: string;
  [key: string]: unknown;
}

export interface ReservationListResult {
  scope: ReservationScope;
  items: ReservationRow[];
  nextCursor: string | null;
  /** history：符合條件的總筆數（null = 未知）；active：回傳筆數。 */
  total: number | null;
  /** 不擋畫面的警告（補充資料載入失敗、筆數達上限…），後台以提示列顯示。 */
  warnings: string[];
}

// Keep the admin list contract explicit: selecting `*` accommodates older
// schemas, but newly added database bookkeeping must not reach the browser.
const LIST_FIELDS = [
  "id", "room_id", "customer_name", "phone", "start_time", "end_time", "status",
  "total_price", "guest_count", "notes", "booking_code", "created_at", "is_notified",
  "is_deposit_paid", "deposit_payment_note", "deposit_paid_on", "deposit_last_five",
  "guest_confirmed_at", "pending_payment_reviews", "visit_count", "deposit_auto_cancelled",
] as const;

function pickFields(value: unknown, fields: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(source, field)).map((field) => [field, source[field]]));
}

/** Project only fields used by ReservationList and its payment dialog. */
function projectReservationListRow(row: ReservationRow): ReservationRow {
  const result = pickFields(row, LIST_FIELDS) as ReservationRow;
  if (Object.hasOwn(row, "room_with_branch")) {
    const room = pickFields(row.room_with_branch, ["id", "name", "branch"]);
    if (room && Object.hasOwn(room, "branch")) room.branch = pickFields(room.branch, ["name"]);
    result.room_with_branch = room;
  }
  if (Object.hasOwn(row, "preorder")) {
    result.preorder = pickFields(row.preorder, ["status", "requires_reconfirmation", "item_summary", "guest_notes"]);
  }
  return result;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SCOPE_REQUIRED_MESSAGE = "後台已更新，請重新整理頁面";

export function encodeCursor(row: { start_time: string; id: string }): string {
  return Buffer.from(JSON.stringify({ t: row.start_time, id: row.id })).toString("base64url");
}

/**
 * 游標時間必須是 Postgres timestamptz 的 ISO-8601 字串（保留到微秒，不經 toISOString 以免精度遺失）。
 * 嚴格比對是因為它會被放進 PostgREST 的 `or=(...)` 語法；寬鬆的 Date.parse 會放行
 * `2026-10-20T06:00:00Z",id.neq.x` 之類的注入字串。
 */
const CURSOR_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export function decodeCursor(raw: string): ReservationCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<ReservationCursor>;
    if (typeof parsed.t !== "string" || typeof parsed.id !== "string") return null;
    if (!CURSOR_TIME_RE.test(parsed.t) || Number.isNaN(Date.parse(parsed.t)) || !UUID_RE.test(parsed.id)) return null;
    return { t: parsed.t, id: parsed.id };
  } catch {
    return null;
  }
}

/**
 * 搜尋字只保留安全字元：PostgREST `or=(...)` 語法裡逗號、括號、引號、冒號、句點有意義，
 * `*`/`%` 是萬用字元。空白也拿掉（與前端 normalizeText 一致）。
 */
export function sanitizeSearch(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[\s,()"'\\*%:.]/g, "").slice(0, 50);
}

export function parseReservationListParams(
  sp: URLSearchParams
): { ok: true; params: ReservationListParams } | { ok: false; error: string } {
  const branchId = sp.get("branchId");
  if (!branchId) return { ok: false, error: "缺少 branchId" };
  const scope = sp.get("scope");
  if (scope !== "active" && scope !== "history") return { ok: false, error: SCOPE_REQUIRED_MESSAGE };

  const rangeRaw = sp.get("range") ?? "30d";
  if (!["7d", "30d", "90d", "all"].includes(rangeRaw)) return { ok: false, error: "range 只接受 7d、30d、90d、all" };
  const statusRaw = (sp.get("status") ?? "all") as HistoryStatusFilter;
  if (!HISTORY_STATUS_FILTERS.includes(statusRaw)) return { ok: false, error: "status 篩選不正確" };

  const limitRaw = Number(sp.get("limit") ?? DEFAULT_PAGE_SIZE);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(limitRaw)))
    : DEFAULT_PAGE_SIZE;

  let cursor: ReservationCursor | null = null;
  const cursorRaw = sp.get("cursor");
  if (cursorRaw) {
    cursor = decodeCursor(cursorRaw);
    if (!cursor) return { ok: false, error: "cursor 不正確，請重新整理" };
  }

  const id = sp.get("id");
  if (id && !UUID_RE.test(id)) return { ok: false, error: "id 不正確" };

  return {
    ok: true,
    params: {
      branchId,
      scope,
      range: rangeRaw as HistoryRange,
      status: statusRaw,
      q: sanitizeSearch(sp.get("q")),
      cursor,
      limit,
      id: id || null,
    },
  };
}

/** 範圍起點：台北日曆日 N 天前的 00:00（+08:00），轉成 ISO。 */
export function historyRangeStartIso(range: HistoryRange, now = new Date()): string | null {
  if (range === "all") return null;
  const day = taipeiDatePlusDays(-RANGE_DAYS[range], now);
  return new Date(`${day}T00:00:00+08:00`).toISOString();
}

function quote(value: string): string {
  return `"${value}"`;
}

/**
 * LIKE 的單字元萬用字元 `_` 要跳脫成字面底線。值放在 PostgREST 雙引號裡，引號內的反斜線本身也要跳脫，
 * 所以送出 `\\_`，PostgREST 解開成 `\_` 交給 Postgres（LIKE 預設跳脫字元是反斜線）。
 * `%`、`*`、反斜線、引號已在 sanitizeSearch 移除。
 */
export function likePattern(q: string): string {
  return quote(`*${q.replace(/_/g, "\\\\_")}*`);
}

/** `or` 條件：姓名／電話／訂位代號／備註模糊比對，加上包廂名稱命中的 room_id。 */
export function searchExpression(q: string, matchingRoomIds: string[]): string | null {
  if (!q) return null;
  const like = likePattern(q);
  const parts = [
    `customer_name.ilike.${like}`,
    `phone.ilike.${like}`,
    `booking_code.ilike.${like}`,
    `notes.ilike.${like}`,
  ];
  if (matchingRoomIds.length) parts.push(`room_id.in.(${matchingRoomIds.join(",")})`);
  return parts.join(",");
}

/** keyset：(start_time, id) 嚴格小於（desc）或大於（asc）游標。 */
export function cursorExpression(cursor: ReservationCursor, direction: "desc" | "asc"): string {
  const op = direction === "desc" ? "lt" : "gt";
  return `start_time.${op}.${quote(cursor.t)},and(start_time.eq.${quote(cursor.t)},id.${op}.${cursor.id})`;
}

/** 多個 `or` 條件要同時成立時合成單一 `or=(and(or(a),or(b)))`，避免重複的 or 參數。 */
export function combineOr(expressions: (string | null)[]): string | null {
  const present = expressions.filter((e): e is string => Boolean(e));
  if (present.length === 0) return null;
  if (present.length === 1) return present[0];
  return `and(${present.map((e) => `or(${e})`).join(",")})`;
}

function compareDesc(a: ReservationRow, b: ReservationRow): number {
  if (a.start_time !== b.start_time) return a.start_time < b.start_time ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function afterCursorDesc(row: ReservationRow, cursor: ReservationCursor): boolean {
  const t = Date.parse(row.start_time);
  const c = Date.parse(cursor.t);
  return t < c || (t === c && row.id < cursor.id);
}

export async function fetchBranchRooms(db: Db, branchId: string): Promise<{ id: string; name: string }[]> {
  const { data, error } = await db.from("rooms").select("id,name").eq("branch_id", branchId);
  if (error) throw new Error("Supabase rooms error: " + error.message);
  return (data ?? []) as { id: string; name: string }[];
}

export interface TimeWindow {
  fromIso: string;
  toIso: string;
}

/**
 * 與時間窗重疊的訂位（`start_time < to` 且 `end_time > from`），限分店包廂。
 * 用 overview-data 的 fetchAll 分頁取完，不會被 PostgREST max_rows（1000）截斷；
 * 多個時間窗合併、依 id 去重，舊到新。
 *
 * 取代以前的 `fetchReservationsAdmin`（一次撈分店有史以來全部訂位、舊到新、超過 1000 筆時最新的被截掉），
 * 給儀表板、統計、7 日趨勢、時間軸用：它們只看某一天、某 7 天或「現在」。
 */
export async function fetchReservationsOverlapping(
  branchId: string,
  windows: TimeWindow[],
  options: { db?: Db } = {}
): Promise<ReservationRow[]> {
  const db = options.db ?? supabaseAdmin();
  const roomIds = (await fetchBranchRooms(db, branchId)).map((r) => r.id);
  if (roomIds.length === 0 || windows.length === 0) return [];
  const byId = new Map<string, ReservationRow>();
  for (const w of windows) {
    const rows = await fetchAll<ReservationRow>((from, to) =>
      db
        .from("reservations")
        .select(RESERVATION_SELECT)
        .in("room_id", roomIds)
        .lt("start_time", w.toIso)
        .gt("end_time", w.fromIso)
        .order("start_time", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: ReservationRow[] | null; error: { message: string } | null }>
    );
    for (const r of rows) byId.set(r.id, r);
  }
  return [...byId.values()].sort((a, b) =>
    a.start_time !== b.start_time ? (a.start_time < b.start_time ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );
}

/**
 * 依 keyset 一批批撈未結案訂位，最多 `max` 筆；多撈 1 筆判斷是否被截斷
 * （剛好 `max` 筆時不會誤報超過上限）。
 */
async function fetchActiveSegment(
  db: Db,
  roomIds: string[],
  bound: { op: "gte" | "lt"; iso: string },
  direction: "asc" | "desc",
  max: number
): Promise<{ rows: ReservationRow[]; truncated: boolean }> {
  const rows: ReservationRow[] = [];
  let cursor: ReservationCursor | null = null;
  for (;;) {
    const want = Math.min(ACTIVE_BATCH, max + 1 - rows.length);
    if (want <= 0) break;
    const base = db
      .from("reservations")
      .select(RESERVATION_SELECT)
      .in("room_id", roomIds)
      .not("status", "in", `(${HISTORY_STATUSES.join(",")})`);
    let query = bound.op === "gte" ? base.gte("start_time", bound.iso) : base.lt("start_time", bound.iso);
    if (cursor) query = query.or(cursorExpression(cursor, direction));
    const { data, error } = await query
      .order("start_time", { ascending: direction === "asc" })
      .order("id", { ascending: direction === "asc" })
      .limit(want);
    if (error) throw new Error("Supabase reservations error: " + error.message);
    const batch = (data ?? []) as ReservationRow[];
    rows.push(...batch);
    if (batch.length < want) return { rows, truncated: false };
    const last = batch[batch.length - 1];
    cursor = { t: last.start_time, id: last.id };
  }
  return { rows: rows.slice(0, max), truncated: rows.length > max };
}

/**
 * 未結案訂位：先撈今天（台北）以後的（舊到新），剩下的額度再撈最近的過期未結案（新到舊），
 * 所以超過上限時被截掉的是最舊的過期列，不是即將到來的訂位。回傳整體舊到新。
 */
async function fetchActive(db: Db, roomIds: string[], warnings: string[], now = new Date()) {
  const todayStartIso = new Date(`${taipeiDatePlusDays(0, now)}T00:00:00+08:00`).toISOString();
  const upcoming = await fetchActiveSegment(db, roomIds, { op: "gte", iso: todayStartIso }, "asc", ACTIVE_CAP);
  const past = await fetchActiveSegment(db, roomIds, { op: "lt", iso: todayStartIso }, "desc", ACTIVE_CAP - upcoming.rows.length);
  if (upcoming.truncated || past.truncated) {
    warnings.push(
      `未結案訂位超過 ${ACTIVE_CAP} 筆，已優先顯示今天以後的訂位，較早的過期訂位只顯示最近的部分；請把過期訂位標為完成或沒來。`
    );
  }
  return [...past.rows.reverse(), ...upcoming.rows];
}

async function fetchHistoryPage(
  db: Db,
  roomIds: string[],
  params: ReservationListParams,
  searchExpr: string | null,
  fromIso: string | null
) {
  const statuses = params.status === "all" ? [...HISTORY_STATUSES] : [params.status];
  let query = db
    .from("reservations")
    .select(RESERVATION_SELECT, { count: "exact" })
    .in("room_id", roomIds)
    .in("status", statuses);
  if (fromIso) query = query.gte("start_time", fromIso);
  const or = combineOr([searchExpr, params.cursor ? cursorExpression(params.cursor, "desc") : null]);
  if (or) query = query.or(or);
  const { data, error, count } = await query
    .order("start_time", { ascending: false })
    .order("id", { ascending: false })
    .limit(params.limit + 1);
  if (error) throw new Error("Supabase reservations error: " + error.message);
  const rows = (data ?? []) as ReservationRow[];
  const hasMore = rows.length > params.limit;
  const items = rows.slice(0, params.limit);
  return {
    items,
    nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null,
    // 有游標時 count 只算游標之後，第一頁才是總數
    total: params.cursor ? null : count ?? null,
  };
}

/** 只看未付訂金自動取消：候選集合很小，逐批（100）撈出再在記憶體排序分頁。 */
async function fetchAutoCancelledPage(
  db: Db,
  roomIds: string[],
  params: ReservationListParams,
  searchExpr: string | null,
  fromIso: string | null,
  warnings: string[]
) {
  const { ids, complete } = await listDepositAutoCancelledCandidateIds(db);
  if (!complete) warnings.push("未付訂金自動取消的紀錄過多，篩選結果可能不完整。");
  const matched: ReservationRow[] = [];
  for (const ids100 of chunk([...ids])) {
    let query = db
      .from("reservations")
      .select(RESERVATION_SELECT)
      .in("room_id", roomIds)
      .eq("status", "cancelled")
      .in("id", ids100);
    if (fromIso) query = query.gte("start_time", fromIso);
    if (searchExpr) query = query.or(searchExpr);
    const { data, error } = await query;
    if (error) throw new Error("Supabase reservations error: " + error.message);
    matched.push(...((data ?? []) as ReservationRow[]));
  }
  matched.sort(compareDesc);
  const afterCursor = params.cursor ? matched.filter((r) => afterCursorDesc(r, params.cursor!)) : matched;
  const items = afterCursor.slice(0, params.limit);
  const hasMore = afterCursor.length > params.limit;
  return {
    items: items.map((r) => ({ ...r, deposit_auto_cancelled: true })),
    nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null,
    total: params.cursor ? null : matched.length,
  };
}

/** 熟客標記：同電話在本分店未取消的訂位數（只需判斷 >= 門檻，達 1000 筆上限也不影響判斷）。 */
export async function fetchPhoneVisitCounts(db: Db, roomIds: string[], phones: string[]) {
  const counts = new Map<string, number>();
  const unique = [...new Set(phones.filter(Boolean))];
  for (const group of chunk(unique, PHONE_CHUNK)) {
    const { data, error } = await db
      .from("reservations")
      .select("phone")
      .in("room_id", roomIds)
      .neq("status", "cancelled")
      .in("phone", group)
      .limit(1000);
    if (error) throw error;
    for (const row of data ?? []) {
      const phone = String((row as { phone?: unknown }).phone ?? "");
      if (phone) counts.set(phone, (counts.get(phone) ?? 0) + 1);
    }
  }
  return counts;
}

export interface EnrichDeps {
  pendingCounts: (ids: string[]) => Promise<Map<string, number>>;
  preorders: (ids: string[]) => Promise<Map<string, unknown>>;
  autoCancelled: (ids: string[], onError: (e: unknown) => void) => Promise<Set<string>>;
  visitCounts: (phones: string[]) => Promise<Map<string, number>>;
}

/**
 * 補充欄位（付款待審、預點餐、自動取消標記、熟客次數）。每一項各自獨立：
 * 任何一項失敗只加一條警告，列表本身照常回傳；不再靜默吞掉。
 */
export async function enrichReservationRows(rows: ReservationRow[], deps: EnrichDeps) {
  const warnings: string[] = [];
  if (rows.length === 0) return { rows, warnings };
  const ids = rows.map((r) => r.id);
  const cancelledIds = rows.filter((r) => r.status === "cancelled").map((r) => r.id);
  let autoCancelledFailed = false;
  const [pending, preorders, autoCancelled, visits] = await Promise.allSettled([
    deps.pendingCounts(ids),
    deps.preorders(ids),
    deps.autoCancelled(cancelledIds, () => {
      autoCancelledFailed = true;
    }),
    deps.visitCounts(rows.map((r) => String(r.phone ?? ""))),
  ]);
  if (pending.status === "rejected") warnings.push("付款待審核標記暫時無法載入");
  if (preorders.status === "rejected") warnings.push("預點餐摘要暫時無法載入");
  if (autoCancelled.status === "rejected" || autoCancelledFailed) warnings.push("「未付訂金自動取消」標記可能不完整");
  if (visits.status === "rejected") warnings.push("熟客標記暫時無法載入");
  const pendingMap = pending.status === "fulfilled" ? pending.value : new Map<string, number>();
  const preorderMap = preorders.status === "fulfilled" ? preorders.value : new Map<string, unknown>();
  const autoSet = autoCancelled.status === "fulfilled" ? autoCancelled.value : new Set<string>();
  const visitMap = visits.status === "fulfilled" ? visits.value : null;
  return {
    rows: rows.map((r) => ({
      ...r,
      pending_payment_reviews: pendingMap.get(r.id) ?? 0,
      preorder: preorderMap.get(r.id) ?? null,
      deposit_auto_cancelled:
        r.status === "cancelled" && (autoSet.has(r.id) || r.deposit_auto_cancelled === true),
      ...(visitMap ? { visit_count: visitMap.get(String(r.phone ?? "")) ?? 0 } : {}),
    })),
    warnings,
  };
}

function defaultEnrichDeps(db: Db, roomIds: string[]): EnrichDeps {
  return {
    pendingCounts: fetchPendingPaymentCountsByReservation,
    preorders: fetchPreorderSummaries,
    autoCancelled: (ids, onError) => fetchDepositAutoCancelledIds(ids, db, onError),
    visitCounts: (phones) => fetchPhoneVisitCounts(db, roomIds, phones),
  };
}

export async function listReservationsForAdmin(
  params: ReservationListParams,
  options: { db?: Db; now?: Date; enrichDeps?: EnrichDeps } = {}
): Promise<ReservationListResult> {
  const db = options.db ?? supabaseAdmin();
  const warnings: string[] = [];
  const rooms = await fetchBranchRooms(db, params.branchId);
  const roomIds = rooms.map((r) => r.id);
  const empty: ReservationListResult = { scope: params.scope, items: [], nextCursor: null, total: 0, warnings };
  if (roomIds.length === 0) return empty;

  let page: { items: ReservationRow[]; nextCursor: string | null; total: number | null };
  if (params.id) {
    // 單筆（從今日／儀表板連結開啟某筆訂位時，它可能不在目前範圍內）
    const { data, error } = await db
      .from("reservations")
      .select(RESERVATION_SELECT)
      .in("room_id", roomIds)
      .eq("id", params.id)
      .limit(1);
    if (error) throw new Error("Supabase reservations error: " + error.message);
    const items = (data ?? []) as ReservationRow[];
    page = { items, nextCursor: null, total: items.length };
  } else if (params.scope === "active") {
    const items = await fetchActive(db, roomIds, warnings, options.now);
    page = { items, nextCursor: null, total: items.length };
  } else {
    const q = params.q.toLowerCase();
    const matchingRoomIds = q
      ? rooms.filter((r) => r.name.toLowerCase().replace(/\s+/g, "").includes(q)).map((r) => r.id)
      : [];
    const searchExpr = searchExpression(params.q, matchingRoomIds);
    const fromIso = historyRangeStartIso(params.range, options.now);
    page =
      params.status === "auto_cancelled"
        ? await fetchAutoCancelledPage(db, roomIds, params, searchExpr, fromIso, warnings)
        : await fetchHistoryPage(db, roomIds, params, searchExpr, fromIso);
  }

  const enriched = await enrichReservationRows(page.items, options.enrichDeps ?? defaultEnrichDeps(db, roomIds));
  return {
    scope: params.scope,
    items: enriched.rows.map(projectReservationListRow),
    nextCursor: page.nextCursor,
    total: page.total,
    warnings: [...warnings, ...enriched.warnings],
  };
}
