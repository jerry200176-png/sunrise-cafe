import { supabaseAdmin } from "@/lib/supabase-admin";
import { logOps } from "@/lib/ops-log";
import { checkOptionSelection, type RuleOption } from "@/lib/option-sets";

export type PreorderStatus = "draft" | "submitted" | "locked" | "cancelled";
export type DraftItemInput = {
  menu_item_id: string;
  quantity: number;
  option_ids?: string[];
  special_notes?: string | null;
};
export type PreorderItemSnapshot = {
  source_menu_item_id: string;
  item_name_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  selected_options_snapshot: Array<{ id: string; group: string; name: string; delta: number }>;
  special_notes: string | null;
};

export function isReservationPreorderEnabled(): boolean {
  return process.env.RESERVATION_PREORDER_ENABLED === "1" || process.env.RESERVATION_PREORDER_ENABLED === "true";
}

export function preorderCutoff(startTime: string): Date {
  return new Date(startTime);
}

export function isPreorderCutoffPassed(startTime: string, now = new Date()): boolean {
  return now >= preorderCutoff(startTime);
}

export function isGuestPreorderEditable(
  reservationStatus: string,
  preorderStatus: string | null | undefined,
  requiresReconfirmation: boolean,
  cutoffPassed: boolean,
): boolean {
  if (cutoffPassed || ["cancelled", "completed"].includes(reservationStatus)) return false;
  if (!preorderStatus) return true;
  return !["submitted", "locked"].includes(preorderStatus);
}

export function canonicalDraftItems(items: DraftItemInput[]): DraftItemInput[] {
  if (!Array.isArray(items) || items.length > 100) throw new Error("餐點數量格式不正確");
  return items.map((item) => {
    if (!item || typeof item.menu_item_id !== "string" || !/^[0-9a-f-]{36}$/i.test(item.menu_item_id)) {
      throw new Error("餐點格式不正確");
    }
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("餐點數量不正確");
    if (item.option_ids != null && !Array.isArray(item.option_ids)) throw new Error("餐點選項格式不正確");
    const optionIds = Array.from(new Set((item.option_ids ?? []).filter((id): id is string => typeof id === "string")));
    if (optionIds.length > 30) throw new Error("餐點選項數量不正確");
    return {
      menu_item_id: item.menu_item_id,
      quantity,
      option_ids: optionIds,
      special_notes: typeof item.special_notes === "string" ? item.special_notes.trim().slice(0, 500) || null : null,
    };
  });
}

export async function getReservationPreorder(reservationId: string) {
  const { data, error } = await supabaseAdmin()
    .from("reservation_preorders")
    .select("id,reservation_id,status,requires_reconfirmation,guest_notes,draft_items,submitted_at,locked_at,cancelled_at,created_at,updated_at,reservation_preorder_items(id,source_menu_item_id,item_name_snapshot,unit_price_snapshot,quantity,selected_options_snapshot,special_notes,created_at)")
    .eq("reservation_id", reservationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getReservationForPreorder(reservationId: string) {
  const { data, error } = await supabaseAdmin()
    .from("reservations")
    .select("id,room_id,status,start_time,end_time,guest_count,customer_name,booking_code,room:rooms(id,name,branch_id)")
    .eq("id", reservationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getPreorderCatalog(reservationId: string) {
  const reservation = await getReservationForPreorder(reservationId);
  const room = Array.isArray(reservation?.room) ? reservation?.room[0] : reservation?.room;
  if (!room?.branch_id) return { reservation, items: [] };
  const { data, error } = await supabaseAdmin()
    .from("menu_items")
    .select("id,name,description,price,image_url,category_id,options:menu_item_options(id,option_group,option_name,price_delta,set_id,set:menu_option_sets(min_select,max_select))")
    .eq("branch_id", room.branch_id)
    .eq("preorder_eligible", true)
    .eq("is_available", true)
    .order("display_order");
  if (error) throw error;
  return { reservation, items: data ?? [] };
}

type CatalogItem = {
  id: string; name: string; price: number | string; branch_id: string; is_available: boolean;
  options: Array<RuleOption & { option_name: string; price_delta: number | string }>;
};

export async function validateAndSnapshotItems(
  reservation: { room?: { branch_id?: string } | { branch_id?: string }[] | null },
  rawItems: DraftItemInput[],
  preorderOnly = true,
  enforceMin = true,
): Promise<PreorderItemSnapshot[]> {
  const items = canonicalDraftItems(rawItems);
  const room = Array.isArray(reservation.room) ? reservation.room[0] : reservation.room;
  const branchId = room?.branch_id;
  if (!branchId) throw new Error("找不到訂位分店");
  const ids = Array.from(new Set(items.map((item) => item.menu_item_id)));
  if (ids.length === 0) return [];
  let query = supabaseAdmin()
    .from("menu_items")
    .select("id,name,price,branch_id,is_available,options:menu_item_options(id,option_group,option_name,price_delta,set_id,set:menu_option_sets(min_select,max_select))")
    .in("id", ids)
    .eq("branch_id", branchId)
    .eq("is_available", true);
  if (preorderOnly) query = query.eq("preorder_eligible", true);
  const { data, error } = await query;
  if (error) throw error;
  const byId = new Map((data ?? []).map((row) => [row.id, row as unknown as CatalogItem]));
  if (byId.size !== ids.length) throw new Error("部分餐點目前無法預訂");
  return items.map((item) => {
    const catalog = byId.get(item.menu_item_id)!;
    const optionById = new Map((catalog.options ?? []).map((option) => [option.id, option]));
    const selected = (item.option_ids ?? []).map((id) => {
      const option = optionById.get(id);
      if (!option) throw new Error("餐點選項已變更，請重新選擇");
      return { id, group: option.option_group, name: option.option_name, delta: Number(option.price_delta) };
    });
    const problem = checkOptionSelection(catalog.options ?? [], selected.map((option) => option.id), enforceMin);
    if (problem) throw new Error(`${catalog.name}：${problem}`);
    return {
      source_menu_item_id: catalog.id,
      item_name_snapshot: catalog.name,
      unit_price_snapshot: Number(catalog.price) + selected.reduce((sum, option) => sum + option.delta, 0),
      quantity: item.quantity,
      selected_options_snapshot: selected,
      special_notes: item.special_notes ?? null,
    };
  });
}

export async function savePreorderDraft(reservationId: string, items: DraftItemInput[], guestNotes: string | null) {
  const reservation = await getReservationForPreorder(reservationId);
  if (!reservation) throw new Error("找不到訂位");
  if (["cancelled", "completed"].includes(reservation.status)) throw new Error("此訂位目前無法提前選餐");
  if (isPreorderCutoffPassed(reservation.start_time)) throw new Error("已超過提前選餐截止時間");
  await validateAndSnapshotItems(reservation, items, true, false); // 草稿可以還沒選完必選項
  const existing = await getReservationPreorder(reservationId);
  if ((existing?.status === "submitted" || existing?.status === "locked") && !existing.requires_reconfirmation) {
    throw new Error("此訂位的預製餐點已送出");
  }
  const draftItems = canonicalDraftItems(items);
  const isReconfirmationDraft = Boolean(existing?.requires_reconfirmation);
  const { data, error } = await supabaseAdmin()
    .from("reservation_preorders")
    .upsert({
      reservation_id: reservationId,
      status: isReconfirmationDraft ? "draft" : (existing?.status ?? "draft"),
      draft_items: draftItems,
      guest_notes: typeof guestNotes === "string" ? guestNotes.trim().slice(0, 1000) || null : null,
      submitted_at: isReconfirmationDraft ? null : existing?.submitted_at ?? null,
      locked_at: isReconfirmationDraft ? null : existing?.locked_at ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "reservation_id" })
    .select("id,reservation_id,status,requires_reconfirmation,guest_notes,draft_items,submitted_at,locked_at,cancelled_at,created_at,updated_at")
    .single();
  if (error) throw error;
  return data;
}

export async function submitPreorder(reservationId: string, items: DraftItemInput[], guestNotes: string | null, idempotencyKey: string) {
  if (!idempotencyKey || idempotencyKey.length > 128) throw new Error("缺少有效的 idempotency key");
  const existing = await getReservationPreorder(reservationId);
  // A retry must be safe even if the cutoff has passed or the catalog changed
  // after the first successful transaction. The committed snapshot is the
  // answer for every later submit attempt.
  if (existing?.status === "submitted" || existing?.status === "locked") return existing;
  const reservation = await getReservationForPreorder(reservationId);
  if (!reservation) throw new Error("找不到訂位");
  if (["cancelled", "completed"].includes(reservation.status)) throw new Error("此訂位目前無法提前選餐");
  if (isPreorderCutoffPassed(reservation.start_time)) throw new Error("已超過提前選餐截止時間");
  await validateAndSnapshotItems(reservation, items);
  const { data, error } = await supabaseAdmin().rpc("submit_reservation_preorder", {
    p_reservation_id: reservationId,
    p_guest_notes: typeof guestNotes === "string" ? guestNotes.trim().slice(0, 1000) || null : null,
    // The SQL function re-reads catalog rows inside the reservation lock and
    // creates the immutable snapshots. Never send client-owned names/prices.
    p_items: canonicalDraftItems(items),
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  logOps("guest", "guest.preorder_submitted", { reservation_id: reservationId });
  return getReservationPreorder(reservationId).then((preorder) => ({ ...preorder, result: data }));
}

export async function cancelReservationPreorder(reservationId: string, reason: string) {
  if (!isReservationPreorderEnabled()) return;
  const { error } = await supabaseAdmin().from("reservation_preorders").update({
    status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("reservation_id", reservationId).neq("status", "cancelled");
  if (error && !/relation|column/i.test(error.message)) throw error;
  logOps("admin", "preorder.cancelled", { reservation_id: reservationId, reason });
}

export async function requirePreorderReconfirmation(reservationId: string, reason: string, actor: string) {
  if (!isReservationPreorderEnabled()) return;
  const { error } = await supabaseAdmin().from("reservation_preorders").update({
    requires_reconfirmation: true, updated_at: new Date().toISOString(),
  }).eq("reservation_id", reservationId).in("status", ["draft", "submitted", "locked"]);
  if (error && !/relation|column/i.test(error.message)) throw error;
  logOps("admin", "preorder.reconfirmation_required", { reservation_id: reservationId, reason, actor });
}

export async function lockReservationPreorder(reservationId: string) {
  if (!isReservationPreorderEnabled()) return;
  const { error } = await supabaseAdmin().from("reservation_preorders").update({
    status: "locked", locked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("reservation_id", reservationId).eq("status", "submitted");
  if (error && !/relation|column/i.test(error.message)) throw error;
}

export async function fetchPreorderSummaries(reservationIds: string[]) {
  if (reservationIds.length === 0) return new Map();
  const { data, error } = await supabaseAdmin()
    .from("reservation_preorders")
    .select("reservation_id,status,requires_reconfirmation,guest_notes,reservation_preorder_items(item_name_snapshot,quantity)")
    .in("reservation_id", reservationIds);
  if (error) throw error;
  return new Map((data ?? []).map((row) => {
    const items = (row.reservation_preorder_items ?? []) as { item_name_snapshot: string; quantity: number }[];
    return [row.reservation_id, { status: row.status, requires_reconfirmation: Boolean(row.requires_reconfirmation), guest_notes: row.guest_notes ?? null, item_summary: items.map((item) => `${item.item_name_snapshot} ×${item.quantity}`).join("、") }];
  }));
}

export async function fetchDailyPrep(branchId: string, date: string) {
  const start = new Date(`${date}T00:00:00+08:00`).toISOString();
  const end = new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const { data: reservations, error: reservationError } = await supabaseAdmin()
    .from("reservations")
    .select("id,booking_code,customer_name,guest_count,start_time,end_time,status,room:rooms!inner(id,name,branch_id)")
    .eq("rooms.branch_id", branchId).gte("start_time", start).lt("start_time", end).neq("status", "cancelled").order("start_time");
  if (reservationError) throw reservationError;
  const ids = (reservations ?? []).map((row) => row.id);
  if (ids.length === 0) return { date, branch_id: branchId, reservations: [], aggregates: [] };
  const { data: preorders, error: preorderError } = await supabaseAdmin()
    .from("reservation_preorders")
    .select("reservation_id,status,requires_reconfirmation,guest_notes,reservation_preorder_items(item_name_snapshot,quantity)")
    .in("reservation_id", ids).in("status", ["submitted", "locked"])
    .eq("requires_reconfirmation", false);
  if (preorderError) throw preorderError;
  const byReservation = new Map((preorders ?? []).map((row) => [row.reservation_id, row]));
  const aggregates = new Map<string, number>();
  const result = (reservations ?? []).map((row) => {
    const preorder = byReservation.get(row.id);
    const items = (preorder?.reservation_preorder_items ?? []) as { item_name_snapshot: string; quantity: number }[];
    for (const item of items) aggregates.set(item.item_name_snapshot, (aggregates.get(item.item_name_snapshot) ?? 0) + item.quantity);
    const room = Array.isArray(row.room) ? row.room[0] : row.room;
    return { ...row, room: room ?? null, preorder: preorder ? { status: preorder.status, requires_reconfirmation: Boolean(preorder.requires_reconfirmation), guest_notes: preorder.guest_notes, items } : null };
  });
  return { date, branch_id: branchId, reservations: result, aggregates: Array.from(aggregates, ([item_name, quantity]) => ({ item_name, quantity })).sort((a, b) => a.item_name.localeCompare(b.item_name)) };
}
