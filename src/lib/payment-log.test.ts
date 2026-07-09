import { describe, it, expect, vi, afterEach } from "vitest";
import { logDepositStatusChange } from "./payment-log";

describe("logDepositStatusChange", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits structured JSON without PII fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logDepositStatusChange({
      action: "deposit.marked_paid",
      reservation_id: "uuid-1",
      booking_code: "ABC123",
      actor_type: "admin_session",
      before: { is_deposit_paid: false },
      after: { is_deposit_paid: true },
    });
    expect(spy).toHaveBeenCalledOnce();
    const line = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.domain).toBe("payment");
    expect(parsed.action).toBe("deposit.marked_paid");
    expect(parsed.reservation_id).toBe("uuid-1");
    expect(parsed.booking_code).toBe("ABC123");
    expect(parsed.actor_type).toBe("admin_session");
    expect(parsed).not.toHaveProperty("customer_name");
    expect(parsed).not.toHaveProperty("phone");
  });

  it("truncates long deposit notes", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const longNote = "x".repeat(250);
    logDepositStatusChange({
      action: "deposit.note_updated",
      reservation_id: "uuid-1",
      actor_type: "line_webhook_text",
      before: { deposit_payment_note: longNote },
      after: { deposit_payment_note: longNote },
    });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.before.deposit_payment_note).toHaveLength(201);
    expect(parsed.before.deposit_payment_note.endsWith("…")).toBe(true);
  });
});
