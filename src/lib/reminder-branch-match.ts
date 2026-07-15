/**
 * Match a reservation row to a branch for multi-branch LINE reminders.
 * Prefers nested branch.id / rooms.branch_id; reservation.branch_id is a rare fallback.
 */
export type ReminderRoomShape = {
  branch_id?: string | null;
  branch?: { id?: string | null; name?: string | null } | null;
};

export type ReminderReservationShape = {
  branch_id?: string | null;
  room?: ReminderRoomShape | null;
};

export function reservationMatchesBranch(
  row: ReminderReservationShape,
  branch: { id: string }
): boolean {
  const room = row.room;
  if (room?.branch?.id != null && room.branch.id === branch.id) return true;
  if (room?.branch_id != null && room.branch_id === branch.id) return true;
  if (row.branch_id != null && row.branch_id === branch.id) return true;
  return false;
}
