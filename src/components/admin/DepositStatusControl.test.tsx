/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DepositStatusControl } from "./DepositStatusControl";
import type { Reservation } from "@/types";

describe("DepositStatusControl", () => {
  const baseReservation: Reservation = {
    id: "res-test-1",
    room_id: "room-1",
    customer_name: "張先生",
    phone: "0912345678",
    start_time: "2026-09-12T14:00:00+08:00",
    end_time: "2026-09-12T16:00:00+08:00",
    status: "confirmed",
    total_price: 1200,
    guest_count: 4,
    notes: null,
    is_deposit_paid: false,
    deposit_payment_note: null,
    created_at: "2026-09-08T10:00:00+08:00",
  };

  it("renders one-click approve button and side-effect notice when deposit is unpaid", () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <DepositStatusControl
        reservation={baseReservation}
        isDepositRequired={true}
        onUpdateDepositStatus={onUpdate}
      />
    );

    expect(screen.getByText("💰 需收訂金")).toBeDefined();
    expect(screen.getByText(/核准自動發 LINE 通知/)).toBeDefined();
    expect(screen.getByRole("button", { name: /一鍵核准訂金/ })).toBeDefined();
  });

  it("approves deposit with a single click without requiring text input", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <DepositStatusControl
        reservation={baseReservation}
        isDepositRequired={true}
        onUpdateDepositStatus={onUpdate}
      />
    );

    const approveBtn = screen.getByRole("button", { name: /一鍵核准訂金/ });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith("res-test-1", true, null);
    });
  });

  it("warns when pending payment reviews exist before approval", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const onOpenConfirm = vi.fn().mockResolvedValue(false); // cancel
    const resWithPending: Reservation = {
      ...baseReservation,
      pending_payment_reviews: 2,
    };

    render(
      <DepositStatusControl
        reservation={resWithPending}
        isDepositRequired={true}
        onUpdateDepositStatus={onUpdate}
        onOpenConfirm={onOpenConfirm}
      />
    );

    const approveBtn = screen.getByRole("button", { name: /一鍵核准訂金/ });
    fireEvent.click(approveBtn);

    expect(onOpenConfirm).toHaveBeenCalledWith(
      expect.stringContaining("付款待審核"),
      expect.stringContaining("2 筆")
    );
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("supports separate remark entry via '填備註核准'", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const onOpenPrompt = vi.fn().mockResolvedValue("末五碼 98765");

    render(
      <DepositStatusControl
        reservation={baseReservation}
        isDepositRequired={true}
        onUpdateDepositStatus={onUpdate}
        onOpenPrompt={onOpenPrompt}
      />
    );

    const noteBtn = screen.getByRole("button", { name: /填備註核准/ });
    fireEvent.click(noteBtn);

    expect(onOpenPrompt).toHaveBeenCalledWith(
      expect.stringContaining("備註"),
      expect.any(String),
      ""
    );

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith("res-test-1", true, "末五碼 98765");
    });
  });

  it("renders paid status, remark tag, and LINE delivery indicator when paid", () => {
    const paidReservation: Reservation = {
      ...baseReservation,
      is_deposit_paid: true,
      deposit_payment_note: "LINE Pay 轉帳",
      deposit_approved_notified_at: "2026-09-08T12:00:00+08:00",
    };

    render(
      <DepositStatusControl
        reservation={paidReservation}
        isDepositRequired={true}
        onUpdateDepositStatus={vi.fn()}
      />
    );

    expect(screen.getByText("已付訂金")).toBeDefined();
    expect(screen.getByText("📝 LINE Pay 轉帳")).toBeDefined();
    expect(screen.getByText(/LINE 通知已送達/)).toBeDefined();
    expect(screen.getByRole("button", { name: /改為未付/ })).toBeDefined();
  });

  it("allows resetting back to unpaid with confirmation", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const onOpenConfirm = vi.fn().mockResolvedValue(true);
    const paidReservation: Reservation = {
      ...baseReservation,
      is_deposit_paid: true,
    };

    render(
      <DepositStatusControl
        reservation={paidReservation}
        isDepositRequired={true}
        onUpdateDepositStatus={onUpdate}
        onOpenConfirm={onOpenConfirm}
      />
    );

    const unpaidBtn = screen.getByRole("button", { name: /改為未付/ });
    fireEvent.click(unpaidBtn);

    expect(onOpenConfirm).toHaveBeenCalledWith(
      expect.stringContaining("未付訂金"),
      expect.any(String)
    );

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith("res-test-1", false, null);
    });
  });
});
