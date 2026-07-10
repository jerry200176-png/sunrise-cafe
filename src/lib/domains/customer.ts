/** Domain facade — customer insights & retention (privacy-safe) */
export {
  findInactiveCustomers,
  findReviewInviteCandidates,
  findAnniversaryOpportunities,
} from "@/lib/customer-retention";

export type { ReservationLite } from "@/lib/customer-retention";
