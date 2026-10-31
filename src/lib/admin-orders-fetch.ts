import { fetchWithTimeout, readJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { responseError } from "@/lib/friendly-error";
import type { Order } from "@/types";
import { MAX_AGE_MS } from "@/lib/print-queue";

/** Never return partial results: the caller keeps its previous state if any page fails. */
export async function fetchAllAdminOrders(branchId: string, isCurrent: () => boolean = () => true, scope?: "active" | "printable"): Promise<Order[]> {
  const all: Order[] = [];
  const seen = new Set<string>();
  const seenOrders = new Set<string>();
  let cursor: string | null = null;
  const since = scope === "printable" ? new Date(Date.now() - MAX_AGE_MS).toISOString() : null;
  for (let page = 0; page < 50; page++) {
    if (!isCurrent()) throw new Error("分店已變更");
    const params = new URLSearchParams({ branchId, limit: "100" });
    if (scope) params.set("scope", scope);
    if (since) params.set("since", since);
    if (cursor) params.set("cursor", cursor);
    const res = await fetchWithTimeout(`/api/admin/orders?${params}`, { credentials: "include" });
    if (!res.ok) {
      const error = new Error(await responseError(res));
      Object.assign(error, { status: res.status });
      throw error;
    }
    const body = await readJsonWithTimeout<{ items?: unknown; nextCursor?: unknown }>(res);
    if (!body || !Array.isArray(body.items) || (body.nextCursor !== null && (typeof body.nextCursor !== "string" || !body.nextCursor))) {
      throw new Error("訂單資料格式不正確，請重試");
    }
    for (const order of body.items as Order[]) {
      if (!order || typeof order.id !== "string" || seenOrders.has(order.id)) throw new Error("訂單資料不一致，請重試");
      seenOrders.add(order.id);
      all.push(order);
    }
    if (!body.nextCursor) return all;
    if (seen.has(body.nextCursor)) throw new Error("訂單分頁重複，請重試");
    seen.add(body.nextCursor);
    cursor = body.nextCursor;
  }
  throw new Error("訂單數量過多，請聯絡管理者處理");
}

export async function fetchPendingPrintStatus(branchId: string, id: string): Promise<Order> {
  const res = await fetchWithTimeout(`/api/admin/orders/${encodeURIComponent(id)}?branchId=${encodeURIComponent(branchId)}`, { credentials: "include" });
  if (!res.ok) throw new Error(await responseError(res));
  const row = await readJsonWithTimeout<Order>(res);
  if (!row || row.id !== id || row.branch_id !== branchId || typeof row.is_printed !== "boolean") {
    throw new Error("無法核對訂單列印狀態");
  }
  return row;
}
