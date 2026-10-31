import { describe, expect, it } from "vitest";
import type { Order } from "@/types";
import { pickUnprinted, reconnectDelayMs } from "./print-queue";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const mk = (o: Partial<Order>): Order =>
  ({ id: "x", branch_id: "b", table_id: null, status: "pending", total_amount: 0, notes: null, is_printed: false,
     created_at: "2026-10-08T11:00:00Z", order_items: [{ id: "i" } as never], ...o }) as Order;

describe("pickUnprinted", () => {
  it("skips printed, empty (items not written yet), finished, old and already-sent orders; oldest first", () => {
    const orders = [
      mk({ id: "new", created_at: "2026-10-08T11:50:00Z" }),
      mk({ id: "old-ok", created_at: "2026-10-08T10:00:00Z" }),
      mk({ id: "printed", is_printed: true }),
      mk({ id: "empty", order_items: [] }),
      mk({ id: "done", status: "completed" }),
      mk({ id: "cancelled", status: "cancelled" }),
      mk({ id: "ancient", created_at: "2026-10-07T01:00:00Z" }),
      mk({ id: "session" }),
    ];
    expect(pickUnprinted(orders, new Set(["session"]), NOW).map((o) => o.id)).toEqual(["old-ok", "new"]);
  });
  it("prints an initially empty order after its delayed items appear", () => {
    const order = mk({ id: "delayed", order_items: [] });
    expect(pickUnprinted([order], new Set(), NOW)).toEqual([]);
    expect(pickUnprinted([{ ...order, order_items: [{ id: "item" } as never] }], new Set(), NOW + 1000).map((item) => item.id)).toEqual(["delayed"]);
  });
});

describe("reconnectDelayMs", () => {
  it("backs off then caps at 30s", () => {
    expect([0, 1, 2, 3, 4, 9].map(reconnectDelayMs)).toEqual([2000, 5000, 10000, 20000, 30000, 30000]);
  });
});
