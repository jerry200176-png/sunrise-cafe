import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: vi.fn() }));

import { fetchDepositAutoCancelledIds } from "./deposit-auto-cancelled";

type Filter = [string, string, unknown];

function fakeDb(tables: Record<string, { rows: Record<string, unknown>[]; error?: unknown; throws?: boolean }>) {
  const queries: { table: string; filters: Filter[] }[] = [];
  const db = {
    from(table: string) {
      const q = { table, filters: [] as Filter[] };
      queries.push(q);
      const builder = {
        select: () => builder,
        eq: (c: string, v: unknown) => (q.filters.push(["eq", c, v]), builder),
        in: (c: string, v: unknown) => (q.filters.push(["in", c, v]), builder),
        then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
          const t = tables[table];
          if (t?.throws) return reject(new Error("boom"));
          resolve({ data: t?.error ? null : t?.rows ?? [], error: t?.error ?? null });
        },
      };
      return builder;
    },
  };
  return { db: db as never, queries };
}

describe("fetchDepositAutoCancelledIds", () => {
  it("unions the release ledger and the lifecycle audit, scoped to the given ids", async () => {
    const { db, queries } = fakeDb({
      line_reminder_deliveries: { rows: [{ reservation_id: "a" }] },
      ops_events: { rows: [{ detail: { reservation_id: "b", reason: "deposit_deadline" } }] },
    });
    const ids = await fetchDepositAutoCancelledIds(["a", "b", "c"], db);
    expect([...ids].sort()).toEqual(["a", "b"]);
    expect(queries[0].filters).toContainEqual(["in", "reminder_type", ["deposit_release_group", "deposit_release_guest"]]);
    expect(queries[1].filters).toContainEqual(["eq", "detail->>reason", "deposit_deadline"]);
    expect(queries[1].filters).toContainEqual(["in", "detail->>reservation_id", ["a", "b", "c"]]);
  });

  it("asks nothing for an empty list", async () => {
    const { db, queries } = fakeDb({});
    expect((await fetchDepositAutoCancelledIds([], db)).size).toBe(0);
    expect(queries).toEqual([]);
  });

  it("fails open (label only) when a source is missing or errors", async () => {
    const { db } = fakeDb({
      line_reminder_deliveries: { rows: [], throws: true },
      ops_events: { rows: [], error: { message: "relation ops_events does not exist" } },
    });
    expect((await fetchDepositAutoCancelledIds(["a"], db)).size).toBe(0);
  });

  it("chunks long id lists", async () => {
    const { db, queries } = fakeDb({ line_reminder_deliveries: { rows: [] }, ops_events: { rows: [] } });
    await fetchDepositAutoCancelledIds(Array.from({ length: 250 }, (_, i) => `id${i}`), db);
    expect(queries).toHaveLength(6);
  });
});
