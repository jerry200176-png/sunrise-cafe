/** Browser-instance lock: do not resend a reservation mutation or manual
 * notification while it is in flight or its outcome needs human review.
 * This deliberately does not claim cross-tab or cross-device protection. */
export type ReservationMutationState = { branchId: string; label: string; outcome: "inflight" | "unknown" };
let pending: ReadonlyMap<string, ReservationMutationState> = new Map();
const listeners = new Set<() => void>();
const serverSnapshot: ReadonlyMap<string, ReservationMutationState> = new Map();

export function subscribeReservationMutations(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const reservationMutationsSnapshot = () => pending;
export const reservationMutationsServerSnapshot = () => serverSnapshot;

function publish(next: ReadonlyMap<string, ReservationMutationState>) {
  pending = next;
  for (const listener of listeners) listener();
}

export function beginReservationMutation(id: string, branchId: string, label: string): boolean {
  if (pending.has(id)) return false;
  const next = new Map(pending);
  next.set(id, { branchId, label, outcome: "inflight" });
  publish(next);
  return true;
}

export function markReservationMutationUnknown(id: string): void {
  const current = pending.get(id);
  if (!current) return;
  const next = new Map(pending);
  next.set(id, { ...current, outcome: "unknown" });
  publish(next);
}

export function endReservationMutation(id: string): void {
  if (pending.get(id)?.outcome !== "inflight") return;
  const next = new Map(pending);
  next.delete(id);
  publish(next);
}

/** Only clear the exact uncertain state the person acknowledged. */
export function clearReservationMutationUnknown(id: string, expected: ReservationMutationState): void {
  if (pending.get(id) !== expected || expected.outcome !== "unknown") return;
  const next = new Map(pending);
  next.delete(id);
  publish(next);
}
