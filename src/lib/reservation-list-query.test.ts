import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/lib/payment-events-admin", () => ({ fetchPendingPaymentCountsByReservation: vi.fn() }));
vi.mock("@/lib/reservation-preorder", () => ({ fetchPreorderSummaries: vi.fn() }));

import {
  ACTIVE_BATCH,
  combineOr,
  cursorExpression,
  decodeCursor,
  encodeCursor,
  enrichReservationRows,
  fetchPhoneVisitCounts,
  historyRangeStartIso,
  listReservationsForAdmin,
  parseReservationListParams,
  sanitizeSearch,
  SCOPE_REQUIRED_MESSAGE,
  type EnrichDeps,
  type ReservationListParams,
} from "./reservation-list-query";

type Call = [string, ...unknown[]];
interface Query {
  table: string;
  calls: Call[];
}
type Resolver = (q: Query) => { data?: unknown[]; error?: unknown; count?: number | null };

/** 最小的 supabase-js query builder 替身：記錄每個呼叫，await 時交給 resolver 決定結果。 */
function fakeDb(resolve: Resolver) {
  const queries: Query[] = [];
  const db = {
    from(table: string) {
      const q: Query = { table, calls: [] };
      queries.push(q);
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "in", "not", "or", "gte", "order", "limit"]) {
        builder[m] = (...args: unknown[]) => {
          q.calls.push([m, ...args]);
          return builder;
        };
      }
      builder.then = (ok: (v: unknown) => void) => {
        const r = resolve(q);
        ok({ data: r.error ? null : r.data ?? [], error: r.error ?? null, count: r.count ?? null });
      };
      return builder;
    },
  };
  return { db: db as never, queries };
}

const has = (q: Query, ...call: unknown[]) =>
  q.calls.some((c) => JSON.stringify(c) === JSON.stringify(call));
const callOf = (q: Query, name: string) => q.calls.find((c) => c[0] === name);

const noEnrich: EnrichDeps = {
  pendingCounts: async () => new Map(),
  preorders: async () => new Map(),
  autoCancelled: async () => new Set(),
  visitCounts: async () => new Map(),
};

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const res = (n: number, status: string, start: string) => ({ id: uuid(n), status, start_time: start, phone: `09${n}` });

function params(over: Partial<ReservationListParams> = {}): ReservationListParams {
  return { branchId: "b1", scope: "history", range: "30d", status: "all", q: "", cursor: null, limit: 50, id: null, ...over };
}

const rooms = [{ id: "r1", name: "A 包廂" }, { id: "r2", name: "大包廂" }];

describe("parseReservationListParams", () => {
  it("requires a scope (old clients get a reload hint) and defaults history to 30 days × 50 rows", () => {
    expect(parseReservationListParams(new URLSearchParams("branchId=b1"))).toEqual({ ok: false, error: SCOPE_REQUIRED_MESSAGE });
    const ok = parseReservationListParams(new URLSearchParams("branchId=b1&scope=history"));
    expect(ok).toMatchObject({ ok: true, params: { range: "30d", status: "all", limit: 50, cursor: null, q: "" } });
  });

  it("clamps the page size and rejects bad cursors, ranges and ids", () => {
    const big = parseReservationListParams(new URLSearchParams("branchId=b1&scope=history&limit=99999"));
    expect(big.ok && big.params.limit).toBe(200);
    expect(parseReservationListParams(new URLSearchParams("branchId=b1&scope=history&cursor=nope")).ok).toBe(false);
    expect(parseReservationListParams(new URLSearchParams("branchId=b1&scope=history&range=1y")).ok).toBe(false);
    expect(parseReservationListParams(new URLSearchParams("branchId=b1&scope=history&id=x")).ok).toBe(false);
  });

  it("round-trips the keyset cursor", () => {
    const c = encodeCursor({ start_time: "2026-10-20T06:00:00+00:00", id: uuid(1) });
    expect(decodeCursor(c)).toEqual({ t: "2026-10-20T06:00:00+00:00", id: uuid(1) });
  });
});

describe("query building", () => {
  it("strips PostgREST syntax and wildcards from search text", () => {
    expect(sanitizeSearch(" 王 小明,(x)*%:.\"' ")).toBe("王小明x");
  });

  it("starts the 30-day window at Taipei midnight", () => {
    // 2026-10-21 01:00 台北 = 2026-10-20T17:00Z
    expect(historyRangeStartIso("30d", new Date("2026-10-20T17:00:00Z"))).toBe("2026-09-20T16:00:00.000Z");
    expect(historyRangeStartIso("all")).toBeNull();
  });

  it("combines search and cursor into one or-filter so both must hold", () => {
    const cursor = cursorExpression({ t: "2026-10-20T06:00:00+00:00", id: uuid(1) }, "desc");
    expect(cursor).toBe(`start_time.lt."2026-10-20T06:00:00+00:00",and(start_time.eq."2026-10-20T06:00:00+00:00",id.lt.${uuid(1)})`);
    expect(combineOr(["a.eq.1,b.eq.2", cursor])).toBe(`and(or(a.eq.1,b.eq.2),or(${cursor}))`);
    expect(combineOr([null, "x.eq.1"])).toBe("x.eq.1");
  });
});

describe("listReservationsForAdmin", () => {
  it("history: terminal statuses, last 30 days, newest first, one extra row to detect the next page", async () => {
    const rows = Array.from({ length: 51 }, (_, i) => res(i + 1, "completed", `2026-10-${String(20 - Math.floor(i / 3)).padStart(2, "0")}T06:00:00+00:00`));
    const { db, queries } = fakeDb((q) => (q.table === "rooms" ? { data: rooms } : { data: rows, count: 120 }));
    const out = await listReservationsForAdmin(params(), { db, now: new Date("2026-10-21T04:00:00Z"), enrichDeps: noEnrich });
    const main = queries.find((q) => q.table === "reservations")!;
    expect(has(main, "in", "room_id", ["r1", "r2"])).toBe(true);
    expect(has(main, "in", "status", ["completed", "cancelled", "no_show"])).toBe(true);
    expect(has(main, "gte", "start_time", "2026-09-20T16:00:00.000Z")).toBe(true);
    expect(has(main, "order", "start_time", { ascending: false })).toBe(true);
    expect(has(main, "limit", 51)).toBe(true);
    expect(callOf(main, "select")?.[2]).toEqual({ count: "exact" });
    expect(out.items).toHaveLength(50);
    expect(out.total).toBe(120);
    expect(decodeCursor(out.nextCursor!)).toEqual({ t: rows[49].start_time, id: rows[49].id });
  });

  it("history: no next page and no total after the first page", async () => {
    const { db, queries } = fakeDb((q) => (q.table === "rooms" ? { data: rooms } : { data: [res(1, "cancelled", "2026-10-01T06:00:00+00:00")], count: 1 }));
    const cursor = { t: "2026-10-05T06:00:00+00:00", id: uuid(9) };
    const out = await listReservationsForAdmin(params({ cursor, q: "大包廂", range: "all" }), { db, enrichDeps: noEnrich });
    const main = queries.find((q) => q.table === "reservations")!;
    expect(callOf(main, "gte")).toBeUndefined();
    const or = String(callOf(main, "or")?.[1]);
    expect(or.startsWith("and(or(customer_name.ilike.*大包廂*")).toBe(true);
    expect(or).toContain("room_id.in.(r2)");
    expect(or).toContain(`id.lt.${uuid(9)}`);
    expect(out.nextCursor).toBeNull();
    expect(out.total).toBeNull();
  });

  it("active: every unfinished booking regardless of date, oldest first, fetched in keyset batches", async () => {
    const batch1 = Array.from({ length: ACTIVE_BATCH }, (_, i) => res(i + 1, "confirmed", `2025-01-01T${String(i % 24).padStart(2, "0")}:00:00+00:00`));
    const batch2 = [res(9999, "pending", "2027-01-01T06:00:00+00:00")];
    let n = 0;
    const { db, queries } = fakeDb((q) => (q.table === "rooms" ? { data: rooms } : { data: n++ === 0 ? batch1 : batch2 }));
    const out = await listReservationsForAdmin(params({ scope: "active" }), { db, enrichDeps: noEnrich });
    const reads = queries.filter((q) => q.table === "reservations");
    expect(reads).toHaveLength(2);
    expect(has(reads[0], "not", "status", "in", "(completed,cancelled,no_show)")).toBe(true);
    expect(callOf(reads[0], "gte")).toBeUndefined();
    expect(has(reads[0], "order", "start_time", { ascending: true })).toBe(true);
    expect(String(callOf(reads[1], "or")?.[1])).toContain(`id.gt.${batch1[ACTIVE_BATCH - 1].id}`);
    expect(out.items).toHaveLength(ACTIVE_BATCH + 1);
    expect(out.warnings).toEqual([]);
  });

  it("auto-cancelled filter: candidate ids are queried in chunks of 100 and paged in memory", async () => {
    const candidates = Array.from({ length: 230 }, (_, i) => uuid(i + 1));
    const { db, queries } = fakeDb((q) => {
      if (q.table === "rooms") return { data: rooms };
      if (q.table === "line_reminder_deliveries") return { data: candidates.map((id) => ({ reservation_id: id })) };
      if (q.table === "ops_events") return { data: [] };
      const ids = (callOf(q, "in") && q.calls.filter((c) => c[0] === "in" && c[1] === "id")[0]?.[2]) as string[];
      return { data: ids.slice(0, 2).map((id, i) => ({ id, status: "cancelled", start_time: `2026-10-0${i + 1}T06:00:00+00:00` })) };
    });
    const out = await listReservationsForAdmin(params({ status: "auto_cancelled", limit: 4 }), { db, enrichDeps: noEnrich });
    const reads = queries.filter((q) => q.table === "reservations");
    expect(reads).toHaveLength(3);
    for (const r of reads) {
      expect(has(r, "eq", "status", "cancelled")).toBe(true);
      expect((r.calls.find((c) => c[0] === "in" && c[1] === "id")?.[2] as string[]).length).toBeLessThanOrEqual(100);
    }
    expect(out.total).toBe(6);
    expect(out.items).toHaveLength(4);
    expect(out.items.every((r) => r.deposit_auto_cancelled === true)).toBe(true);
    expect(out.items[0].start_time >= out.items[1].start_time).toBe(true);
    expect(out.nextCursor).not.toBeNull();
  });

  it("single id lookup stays inside the branch's rooms", async () => {
    const { db, queries } = fakeDb((q) => (q.table === "rooms" ? { data: rooms } : { data: [res(1, "completed", "2025-01-01T06:00:00+00:00")] }));
    const out = await listReservationsForAdmin(params({ id: uuid(1) }), { db, enrichDeps: noEnrich });
    const read = queries.find((q) => q.table === "reservations")!;
    expect(has(read, "in", "room_id", ["r1", "r2"])).toBe(true);
    expect(has(read, "eq", "id", uuid(1))).toBe(true);
    expect(out.items).toHaveLength(1);
  });

  it("a branch without rooms returns an empty list without querying reservations", async () => {
    const { db, queries } = fakeDb(() => ({ data: [] }));
    const out = await listReservationsForAdmin(params(), { db, enrichDeps: noEnrich });
    expect(out.items).toEqual([]);
    expect(queries.map((q) => q.table)).toEqual(["rooms"]);
  });
});

describe("enrichReservationRows", () => {
  const rows = [res(1, "cancelled", "2026-10-01T06:00:00+00:00"), res(2, "completed", "2026-10-02T06:00:00+00:00")];

  it("attaches pending reviews, preorders, auto-cancel labels and visit counts", async () => {
    const out = await enrichReservationRows(rows, {
      pendingCounts: async () => new Map([[uuid(1), 2]]),
      preorders: async () => new Map([[uuid(2), { status: "submitted" }]]),
      autoCancelled: async (ids) => new Set(ids),
      visitCounts: async () => new Map([["091", 4]]),
    });
    expect(out.warnings).toEqual([]);
    expect(out.rows[0]).toMatchObject({ pending_payment_reviews: 2, deposit_auto_cancelled: true, visit_count: 4, preorder: null });
    expect(out.rows[1]).toMatchObject({ pending_payment_reviews: 0, deposit_auto_cancelled: false, preorder: { status: "submitted" } });
  });

  it("turns each failed enrichment into a visible warning and still returns the rows", async () => {
    const out = await enrichReservationRows(rows, {
      pendingCounts: async () => {
        throw new Error("URI too long");
      },
      preorders: async () => {
        throw new Error("boom");
      },
      autoCancelled: async (_ids, onError) => {
        onError(new Error("partial"));
        return new Set();
      },
      visitCounts: async () => {
        throw new Error("boom");
      },
    });
    expect(out.rows).toHaveLength(2);
    expect(out.warnings).toEqual([
      "付款待審核標記暫時無法載入",
      "預點餐摘要暫時無法載入",
      "「未付訂金自動取消」標記可能不完整",
      "熟客標記暫時無法載入",
    ]);
    expect(out.rows[0]).not.toHaveProperty("visit_count");
  });
});

describe("fetchPhoneVisitCounts", () => {
  it("counts non-cancelled bookings per phone, 50 phones per query", async () => {
    const phones = Array.from({ length: 120 }, (_, i) => `09${i}`);
    const { db, queries } = fakeDb(() => ({ data: [{ phone: "090" }, { phone: "090" }, { phone: "091" }] }));
    const counts = await fetchPhoneVisitCounts(db, ["r1"], [...phones, "090", ""]);
    expect(queries).toHaveLength(3);
    expect(has(queries[0], "neq", "status", "cancelled")).toBe(true);
    expect(counts.get("090")).toBe(6);
  });
});
