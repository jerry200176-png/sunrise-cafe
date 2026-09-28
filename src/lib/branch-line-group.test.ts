import { describe, expect, it } from "vitest";
import { branchLineGroupIdForReservation, branchLineGroupIdForRoom } from "./branch-line-group";

function db(data: unknown, fail = false) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => {
      if (fail) throw new Error("db down");
      return { data, error: null };
    },
  };
  return { from: () => chain } as never;
}

describe("branch LINE group lookup", () => {
  it("reads object or array embeds and trims the id", async () => {
    expect(await branchLineGroupIdForRoom(db({ branch: { line_group_id: " C-room " } }), "r1")).toBe("C-room");
    expect(await branchLineGroupIdForReservation(db({ room: [{ branch: [{ line_group_id: "C-res" }] }] }), "x")).toBe("C-res");
  });

  it("returns null (default group) for missing data or lookup errors", async () => {
    expect(await branchLineGroupIdForRoom(db({ branch: { line_group_id: null } }), "r1")).toBeNull();
    expect(await branchLineGroupIdForReservation(db(null), "x")).toBeNull();
    expect(await branchLineGroupIdForReservation(db(null, true), "x")).toBeNull();
  });
});
