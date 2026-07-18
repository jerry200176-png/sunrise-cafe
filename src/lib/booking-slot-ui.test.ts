import { describe, expect, it } from "vitest";
import { slotPanelMode } from "@/lib/booking-slot-ui";

describe("slotPanelMode", () => {
  it("shows loading while fetching", () => {
    expect(slotPanelMode("loading", 0)).toBe("loading");
    expect(slotPanelMode("loading", 5)).toBe("loading");
  });

  it("shows error without empty on fetch rejection", () => {
    expect(slotPanelMode("error", 0)).toBe("error");
  });

  it("shows empty only after successful zero-slot response", () => {
    expect(slotPanelMode("ready", 0)).toBe("empty");
  });

  it("shows grid after successful response with slots", () => {
    expect(slotPanelMode("ready", 3)).toBe("grid");
  });

  it("stays idle before the first fetch", () => {
    expect(slotPanelMode("idle", 0)).toBe("idle");
  });
});
