import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/supabase-admin", () => ({ isAdminConfigured: () => true }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    const builder = {
      select: () => builder, eq: () => builder, gte: () => builder,
      lte: () => builder, order: () => builder,
      limit: async () => ({ data: mocks.rows, error: null }),
    };
    return { from: () => builder };
  },
}));

import { findSuccessfulSendLineRunToday } from "./job-runs";

describe("same-day reminder run result", () => {
  beforeEach(() => { mocks.rows = []; });

  it.each(["no_eligible", "already_notified", "empty_cat", "sent"])(
    "retains successful same-day deduplication for %s",
    async (result) => {
      mocks.rows = [{ id: "synthetic-run", started_at: "2026-09-04T12:00:00.000Z", status: "completed", metadata: { result } }];
      const found = await findSuccessfulSendLineRunToday(new Date("2026-09-04T13:30:00.000Z"));
      expect(found?.id).toBe("synthetic-run");
    }
  );

  it("does not count a duplicate run as a successful original", async () => {
    mocks.rows = [{ id: "duplicate", status: "completed", metadata: { result: "duplicate_skip", duplicate: true } }];
    expect(await findSuccessfulSendLineRunToday(new Date("2026-09-04T13:30:00.000Z"))).toBeNull();
  });
});
