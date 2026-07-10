/**
 * Domain facade — booking (reservations, slots, availability).
 * Import from here in new code; supabase-admin remains implementation detail.
 */
export {
  insertReservationAdmin,
  updateReservationAdmin,
  deleteReservationAdmin,
  fetchReservationsAdmin,
  hasSlotConflict,
  getBlockedSlots,
  fetchReservationByPhoneAndCode,
  fetchReservationsByPhone,
} from "@/lib/supabase-admin";

export { cancelReservation } from "@/lib/reservation-cancel";
export { SlotConflictError } from "@/lib/slot-conflict";
export {
  getDurationOptions,
  getDepositAmount,
  isWeekendDate,
  computeReservationTotalPrice,
} from "@/lib/booking-utils";
