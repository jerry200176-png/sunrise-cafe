/** Browser-instance lock: the same reservation must not be submitted twice
 * while an earlier mutation or manual notification is still in flight.
 * This deliberately does not claim cross-tab or cross-device protection. */
let pending: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const serverSnapshot: ReadonlySet<string> = new Set();

export function subscribeReservationMutations(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const reservationMutationsSnapshot = () => pending;
export const reservationMutationsServerSnapshot = () => serverSnapshot;

function publish(next: ReadonlySet<string>) {
  pending = next;
  for (const listener of listeners) listener();
}

export function beginReservationMutation(id: string): boolean {
  if (pending.has(id)) return false;
  publish(new Set([...pending, id]));
  return true;
}

export function endReservationMutation(id: string): void {
  if (!pending.has(id)) return;
  const next = new Set(pending);
  next.delete(id);
  publish(next);
}
