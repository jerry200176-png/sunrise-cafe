import { describe, expect, it } from "vitest";
import { renderReservationMessage } from "./reservation-message";

const reservation = {
  customer_name: "王小明",
  start_time: "2026-06-20T02:00:00Z",
  end_time: "2026-06-20T04:00:00Z",
  total_price: 1000,
  guest_count: 4,
  booking_code: "ABC123",
  created_at: "2026-06-19T02:00:00Z",
  is_deposit_paid: true,
};

const branch = {
  display_name: "昇昇咖啡（大安店）",
  payment_info: "銀行：測試銀行 123",
  line_pay_url: "https://pay.example/abc",
};

describe("renderReservationMessage", () => {
  it("renders booking details in the confirmation", () => {
    const text = renderReservationMessage("booking_confirmation", reservation, branch);
    expect(text).toContain("2026/06/20 (週六)");
    expect(text).toContain("10:00–12:00");
    expect(text).toContain("ABC123");
    expect(text).toContain("4 位");
    expect(text).toContain("姓名：王小明\n人數：4 位");
    expect(text).not.toContain("王小明人數");
  });

  it("delegates deposit details to the canonical payment message", () => {
    const text = renderReservationMessage("deposit_request", reservation, branch);
    expect(text).toContain("訂金 $500");
    expect(text).toContain("https://pay.example/abc");
    expect(text).toContain("ABC123 12345");
  });

  it("renders paid and reminder templates without changing payment state", () => {
    const paid = renderReservationMessage("deposit_paid", reservation, branch);
    const reminder = renderReservationMessage("arrival_reminder", reservation, branch);
    expect(paid).toContain("已收到您的訂位訂金 $500");
    expect(reminder).toContain("提醒您即將於");
    expect(reservation.is_deposit_paid).toBe(true);
  });

  it("requires a positive total for deposit requests", () => {
    expect(() =>
      renderReservationMessage("deposit_request", { ...reservation, total_price: null }, branch)
    ).toThrow("尚未設定有效總金額");
  });

  it("does not render a paid message before staff records payment", () => {
    expect(() =>
      renderReservationMessage("deposit_paid", { ...reservation, is_deposit_paid: false }, branch)
    ).toThrow("尚未標記訂金已收到");
  });

  it("omits the guest count line when the reservation has no guest count", () => {
    const text = renderReservationMessage(
      "booking_confirmation",
      { ...reservation, guest_count: null },
      branch
    );
    expect(text).toContain("姓名：王小明");
    expect(text).not.toContain("人數：");
    expect(text).not.toContain("null");
  });
});
