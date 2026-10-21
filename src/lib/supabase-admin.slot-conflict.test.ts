import { beforeEach, describe, expect, it, vi } from "vitest";

const { calls, result } = vi.hoisted(() => ({
  calls: [] as unknown[][],
  result: { data: [] as { id: string }[], error: null as unknown },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    const builder: Record<string, unknown> = {};
    for (const m of ["from", "select", "eq", "neq", "not", "lt", "gt"]) {
      builder[m] = (...args: unknown[]) => {
        calls.push([m, ...args]);
        return builder;
      };
    }
    builder.then = (resolve: (v: unknown) => void) => resolve(result);
    return builder;
  },
}));

import { hasSlotConflict } from "./supabase-admin";

describe("hasSlotConflict", () => {
  beforeEach(() => {
    calls.length = 0;
    result.data = [];
  });

  it("ignores cancelled and no_show bookings, matching the DB exclusion constraint", async () => {
    await hasSlotConflict("room", "2026-10-22T02:00:00Z", "2026-10-22T04:00:00Z", "self");
    expect(calls).toContainEqual(["not", "status", "in", "(cancelled,no_show)"]);
    expect(calls).not.toContainEqual(["neq", "status", "cancelled"]);
    expect(calls).toContainEqual(["neq", "id", "self"]);
  });

  it("reports a conflict when an active overlapping booking exists", async () => {
    result.data = [{ id: "other" }];
    expect(await hasSlotConflict("room", "a", "b")).toBe(true);
    result.data = [];
    expect(await hasSlotConflict("room", "a", "b")).toBe(false);
  });
});
