/**
 * Guest-facing booking policy copy (cancel / deposit / no-show).
 * Editable later via settings; defaults match ops reality (ADR-012: unpaid deposits are not auto-cancelled by default).
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
    "未付訂金可於訂位開始前至少 24 小時在查詢頁自行取消，較晚請聯繫店家。已付訂金無法線上自行取消：訂位開始前至少 48 小時可來電或以 LINE 申請退訂／退款；不足 48 小時請聯繫店員審核。退款金額與結果由店家確認，非自動退款。",
  noShowRule: "未事先取消且當日未到店，訂金可能不予退還，並可能影響後續訂位。",
  litterRule: "可帶外食；離場請自行帶走垃圾，未帶走酌收清潔費 $300。",
};

export function formatBookingPolicyLines(policy: BookingPolicy = DEFAULT_BOOKING_POLICY, cancelRule = policy.cancelRule): string[] {
  return [
    `・${policy.depositRule}`,
    `・${cancelRule}`,
    `・${policy.noShowRule}`,
    `・${policy.litterRule}`,
  ];
}
