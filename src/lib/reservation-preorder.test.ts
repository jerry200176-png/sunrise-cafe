import { describe, expect, it } from "vitest";
import {
  canonicalDraftItems,
  isGuestPreorderEditable,
  isPreorderCutoffPassed,
  preorderCutoff,
} from "@/lib/reservation-preorder";

describe("reservation preorder contract", () => {
  it("allows same-day selection until the reservation starts", () => {
    const start = "2026-10-10T12:00:00.000Z";
    expect(preorderCutoff(start).toISOString()).toBe(start);
    expect(isPreorderCutoffPassed(start, new Date("2026-10-10T11:59:59.999Z"))).toBe(false);
    expect(isPreorderCutoffPassed(start, new Date(start))).toBe(true);
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

  it("keeps submitted prep staff-managed even when reconfirmation is needed", () => {
    expect(isGuestPreorderEditable("confirmed", "submitted", false, false)).toBe(false);
    expect(isGuestPreorderEditable("confirmed", "submitted", true, false)).toBe(false);
    expect(isGuestPreorderEditable("confirmed", "draft", true, false)).toBe(true);
    expect(isGuestPreorderEditable("confirmed", "submitted", true, true)).toBe(false);
    expect(isGuestPreorderEditable("cancelled", null, false, false)).toBe(false);
  });

  it("keeps the submit boundary server-owned", async () => {
    const { readFileSync } = await import("node:fs");
    const migration = readFileSync("supabase/migration-reservation-preorder.sql", "utf8");
    expect(migration).toContain("preorder_eligible = true");
    expect(migration).toContain("is_available = true");
    expect(migration).toContain("v_menu_item.name");
    expect(migration).toContain("v_menu_item.price + v_unit_price");
    expect(migration).not.toContain("v_item->>'item_name_snapshot'");
    expect(migration).not.toContain("v_item->>'unit_price_snapshot'");
  });
});
