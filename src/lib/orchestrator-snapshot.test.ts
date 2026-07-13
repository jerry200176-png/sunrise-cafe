import { describe, expect, it } from "vitest";
import { collectOrchestratorSnapshot } from "@/lib/orchestrator-snapshot";

describe("collectOrchestratorSnapshot", () => {
  it("returns structured task wall from orchestrator artifacts", () => {
    const snap = collectOrchestratorSnapshot();
    expect(snap).toHaveProperty("generated_at");
    expect(snap).toHaveProperty("status");
    expect(Array.isArray(snap.ranked_executable)).toBe(true);
    expect(snap.stall).toHaveProperty("stalled");
    expect(Array.isArray(snap.recent_learnings)).toBe(true);
  });

  it("includes next task when priority.json exists", () => {
    const snap = collectOrchestratorSnapshot();
    if (snap.status !== "unavailable") {
      expect(snap.iteration_count).toBeGreaterThanOrEqual(0);
      expect(typeof snap.operational_mode).toBe("string");
    }
  });
});
