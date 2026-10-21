import { beforeEach, describe, expect, it, vi } from "vitest";

/** 每次 .in(...) 收到的清單；用來確認補充查詢不會把幾百個 id 塞進同一個 URL。 */
const state = vi.hoisted(() => ({
  inLists: [] as unknown[][],
  failOn: null as number | null,
  errorMessage: "URI too long",
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from() {
      const builder: Record<string, unknown> = {};
      let isIn = false;
      for (const m of ["select", "eq", "limit"]) builder[m] = () => builder;
      builder.in = (_col: string, list: unknown[]) => {
        state.inLists.push(list);
        isIn = true;
        return builder;
      };
      builder.then = (ok: (v: unknown) => void) => {
        const failing = isIn && state.failOn === state.inLists.length;
        ok(failing ? { data: null, error: { message: state.errorMessage } } : { data: [], error: null });
      };
      return builder;
    },
  }),
}));

import { fetchPendingPaymentCountsByReservation } from "./payment-events-admin";
import { fetchPreorderSummaries } from "./reservation-preorder";

const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);

beforeEach(() => {
  state.inLists = [];
  state.failOn = null;
  state.errorMessage = "URI too long";
});

describe("enrichment queries are chunked by 100 ids", () => {
  it("payment review counts", async () => {
    await fetchPendingPaymentCountsByReservation(ids);
    expect(state.inLists.map((l) => l.length)).toEqual([100, 100, 50]);
  });

  it("preorder summaries", async () => {
    await fetchPreorderSummaries(ids);
    expect(state.inLists.map((l) => l.length)).toEqual([100, 100, 50]);
  });

  it("surfaces a failing chunk instead of returning a silently partial map", async () => {
    state.failOn = 2;
    await expect(fetchPendingPaymentCountsByReservation(ids)).rejects.toMatchObject({ message: "URI too long" });
    state.inLists = [];
    await expect(fetchPreorderSummaries(ids)).rejects.toMatchObject({ message: "URI too long" });
  });

  it("treats a not-yet-migrated preorder table as no preorders", async () => {
    state.failOn = 1;
    state.errorMessage = "Could not find the table 'public.reservation_preorders' in the schema cache";
    expect((await fetchPreorderSummaries(ids)).size).toBe(0);
  });
});
