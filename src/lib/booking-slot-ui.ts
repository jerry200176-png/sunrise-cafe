/** Pure slot-panel mode — keeps EmptyState off the error/loading paths. */
export type SlotsFetchState = "idle" | "loading" | "ready" | "error";

export type SlotPanelMode = "idle" | "loading" | "error" | "empty" | "grid";

export function slotPanelMode(
  fetchState: SlotsFetchState,
  slotCount: number
): SlotPanelMode {
  if (fetchState === "idle") return "idle";
  if (fetchState === "loading") return "loading";
  if (fetchState === "error") return "error";
  if (fetchState === "ready" && slotCount === 0) return "empty";
  if (fetchState === "ready") return "grid";
  return "idle";
}
