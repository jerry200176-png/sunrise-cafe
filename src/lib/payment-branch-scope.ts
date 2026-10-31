/** Check the joined room as a second boundary even if the data query is misconfigured. */
export function paymentRoomInScope(rooms: unknown, scope: string[] | null): boolean {
  if (scope === null) return true;
  const room = Array.isArray(rooms) ? rooms[0] : rooms;
  if (!room || typeof room !== "object") return false;
  const branchId = (room as { branch_id?: unknown }).branch_id;
  return typeof branchId === "string" && scope.includes(branchId);
}
