import { describe, expect, it } from "vitest";
import {
  canonicalDraftItems,
  isPreorderCutoffPassed,
  preorderCutoff,
} from "@/lib/reservation-preorder";

describe("reservation preorder contract", () => {
  it("uses a strict reservation-start-minus-24-hours cutoff", () => {
    const start = "2026-10-10T12:00:00.000Z";
    expect(preorderCutoff(start).toISOString()).toBe("2026-10-09T12:00:00.000Z");
    expect(isPreorderCutoffPassed(start, new Date("2026-10-09T11:59:59.999Z"))).toBe(false);
    expect(isPreorderCutoffPassed(start, new Date("2026-10-09T12:00:00.000Z"))).toBe(true);
  });

  it("keeps drafts canonical and never accepts client price/name fields", () => {
    expect(canonicalDraftItems([{
      menu_item_id: "00000000-0000-0000-0000-000000000001",
      quantity: 2,
      option_ids: ["option-1", "option-1"],
      special_notes: "  少冰  ",
    }])).toEqual([{
      menu_item_id: "00000000-0000-0000-0000-000000000001",
      quantity: 2,
      option_ids: ["option-1"],
      special_notes: "少冰",
    }]);
  });

  it("rejects malformed quantities and oversized notes", () => {
    expect(() => canonicalDraftItems([{ menu_item_id: "00000000-0000-0000-0000-000000000001", quantity: 0 }])).toThrow();
    expect(canonicalDraftItems([{ menu_item_id: "00000000-0000-0000-0000-000000000001", quantity: 1, special_notes: "x".repeat(600) }])[0]?.special_notes).toHaveLength(500);
  });
});
