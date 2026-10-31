import type { Order } from "@/types";

export const MAX_AGE_MS = 8 * 60 * 60 * 1000;

/**
 * 該補印的訂單：還沒印、有餐點明細（訂單先建立、明細後寫入，空的先跳過等下一輪）、
 * 還在進行中、且是這個班次內的單（避免把很舊的紀錄一次全印出來）。最舊的先印。
 */
export function pickUnprinted(orders: Order[], printedThisSession: Set<string>, now = Date.now()): Order[] {
  return orders
    .filter(
      (o) =>
        !o.is_printed &&
        !printedThisSession.has(o.id) &&
        o.status !== "cancelled" &&
        o.status !== "completed" &&
        (o.order_items?.length ?? 0) > 0 &&
        now - Date.parse(o.created_at) < MAX_AGE_MS
    )
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

/** 斷線後重連的等待秒數：2、5、10、20、之後固定 30。 */
export function reconnectDelayMs(attempt: number): number {
  return [2000, 5000, 10000, 20000][attempt] ?? 30000;
}
