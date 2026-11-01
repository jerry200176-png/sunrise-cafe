/**
 * Guest-facing booking policy copy (cancel / deposit / no-show).
 * Editable later via settings; defaults match ops reality (ADR-012: unpaid deposits are not auto-cancelled).
 */
export type BookingPolicy = {
  depositRule: string;
  cancelRule: string;
  noShowRule: string;
  litterRule: string;
};

export const DEFAULT_BOOKING_POLICY: BookingPolicy = {
  depositRule:
    "訂金期限為「建立訂位後 48 小時」與「訂位開始前 6 小時」兩者較晚者，且不晚於訂位開始時間；逾期未付，店家可能取消訂位。",
  cancelRule:
    "未付訂金可自行於查詢頁取消。已付訂金之取消／退款依店家公告辦理，請儘早來電或以 LINE 聯繫。",
  noShowRule: "未事先取消且當日未到店，訂金可能不予退還，並可能影響後續訂位。",
  litterRule: "可帶外食；離場請自行帶走垃圾，未帶走酌收清潔費 $300。",
};

export function formatBookingPolicyLines(policy: BookingPolicy = DEFAULT_BOOKING_POLICY): string[] {
  return [
    `・${policy.depositRule}`,
    `・${policy.cancelRule}`,
    `・${policy.noShowRule}`,
    `・${policy.litterRule}`,
  ];
}
