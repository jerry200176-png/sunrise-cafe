import { describe, expect, it } from "vitest";
import {
  batchContactKey,
  buildBatchReservationMessage,
  validateBatchReservationContacts,
  type BatchReservationMessageItem,
} from "./reservation-message-batch";

const item = (overrides: Partial<BatchReservationMessageItem> = {}): BatchReservationMessageItem => ({
  reservation_id: "r-1",
  customer_name: "王小明",
  date_label: "2026/08/20 (週四)",
  start_time: "2026-08-20T04:00:00.000Z",
  end_time: "2026-08-20T06:00:00.000Z",
  booking_code: "A001",
  deposit_amount: 500,
  text: "訂金訊息 A001",
  ...overrides,
});

describe("reservation message batch", () => {
  it("keeps each date and booking code separated in the combined clipboard text", () => {
    const text = buildBatchReservationMessage([
      item(),
      item({ reservation_id: "r-2", date_label: "2026/08/21 (週五)", booking_code: "A002", text: "訂金訊息 A002" }),
    ]);
    expect(text).toContain("===== 第 1 筆訂位｜2026/08/20 (週四)｜訂位碼：A001 =====");
    expect(text).toContain("===== 第 2 筆訂位｜2026/08/21 (週五)｜訂位碼：A002 =====");
    expect(text.indexOf("訂金訊息 A001")).toBeLessThan(text.indexOf("訂金訊息 A002"));
  });

  it("uses exact normalized name, phone, and email contact data", () => {
    expect(batchContactKey({ customer_name: " 王 小明 ", phone: "0912-345-678", email: "A@EXAMPLE.COM", branch_id: "b-1" }))
      .toBe("name:王小明|phone:0912345678|email:a@example.com");
    expect(batchContactKey({ customer_name: "王小明", phone: "0912345678", email: null, branch_id: "b-1" }))
      .not.toBe(batchContactKey({ customer_name: "王小明", phone: "0912345678", email: "a@example.com", branch_id: "b-1" }));
  });

  it("blocks cross-customer, cross-branch, missing contact, and cancelled selections", () => {
    const base = { customer_name: "王小明", phone: "0912345678", email: null, branch_id: "b-1", status: "confirmed" };
    expect(validateBatchReservationContacts([base, { ...base, customer_name: "李小美" }]).can_batch_copy).toBe(false);
    expect(validateBatchReservationContacts([base, { ...base, branch_id: "b-2" }]).can_batch_copy).toBe(false);
    expect(validateBatchReservationContacts([base, { ...base, phone: "" }]).can_batch_copy).toBe(false);
    expect(validateBatchReservationContacts([base, { ...base, status: "cancelled" }]).can_batch_copy).toBe(false);
  });

  it("allows exact same-contact reservations in one branch", () => {
    const base = { customer_name: "王小明", phone: "0912345678", email: null, branch_id: "b-1", status: "confirmed" };
    expect(validateBatchReservationContacts([base, base])).toEqual({ can_batch_copy: true, warnings: [] });
  });
});
