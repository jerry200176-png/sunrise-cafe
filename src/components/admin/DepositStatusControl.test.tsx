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

  it("renders approve button and side-effect notice when deposit is unpaid", () => {
    render(
      <DepositStatusControl
        reservation={baseReservation}
        isDepositRequired={true}
        onUpdateDepositStatus={vi.fn()}
        onUpdateDepositInfo={vi.fn()}
      />
    );

    expect(screen.getByText("💰 需收訂金")).toBeDefined();
    expect(screen.getByText(/核准自動發 LINE 通知/)).toBeDefined();
    expect(screen.getByRole("button", { name: /核准訂金/ })).toBeDefined();
  });

  it("requires transfer date and 5-digit last five before approving", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <DepositStatusControl
        reservation={baseReservation}
        isDepositRequired={true}
        onUpdateDepositStatus={onUpdate}
        onUpdateDepositInfo={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /核准訂金/ }));
    const confirmBtn = screen.getByRole("button", { name: "確認" }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("匯款日期"), { target: { value: "2026-09-10" } });
    fireEvent.change(screen.getByLabelText("帳號末五碼"), { target: { value: "98a76" } });
    expect(confirmBtn.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("帳號末五碼"), { target: { value: "98765" } });
    expect(confirmBtn.disabled).toBe(false);
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith("res-test-1", true, {
        deposit_paid_on: "2026-09-10",
        deposit_last_five: "98765",
        deposit_payment_note: null,
      });
    });
  });

  it("allows non-transfer approval with a required note", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <DepositStatusControl
        reservation={baseReservation}
        isDepositRequired={true}
        onUpdateDepositStatus={onUpdate}
        onUpdateDepositInfo={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /核准訂金/ }));
    fireEvent.click(screen.getByLabelText(/其他/));
    const confirmBtn = screen.getByRole("button", { name: "確認" }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/備註/), { target: { value: "現場現金" } });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith("res-test-1", true, {
        deposit_paid_on: null,
        deposit_last_five: null,
        deposit_payment_note: "現場現金",
      });
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
        onUpdateDepositInfo={vi.fn()}
        onOpenConfirm={onOpenConfirm}
      />
    );

    const approveBtn = screen.getByRole("button", { name: /核准訂金/ });
    fireEvent.click(approveBtn);

    expect(onOpenConfirm).toHaveBeenCalledWith(
      expect.stringContaining("付款待審核"),
      expect.stringContaining("2 筆")
    );
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("edits payment info on a paid reservation without re-approving", async () => {
    const onUpdate = vi.fn();
    const onUpdateInfo = vi.fn().mockResolvedValue(undefined);
    render(
      <DepositStatusControl
        reservation={{ ...baseReservation, is_deposit_paid: true, deposit_paid_on: "2026-09-09", deposit_last_five: "11111" }}
        isDepositRequired={true}
        onUpdateDepositStatus={onUpdate}
        onUpdateDepositInfo={onUpdateInfo}
      />
    );

    expect(screen.getByText("🏦 09/09 匯款・末五碼 11111")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /修改付款資料/ }));
    fireEvent.change(screen.getByLabelText("帳號末五碼"), { target: { value: "22222" } });
    fireEvent.click(screen.getByRole("button", { name: "確認" }));

    await waitFor(() => {
      expect(onUpdateInfo).toHaveBeenCalledWith("res-test-1", {
        deposit_paid_on: "2026-09-09",
        deposit_last_five: "22222",
        deposit_payment_note: null,
      });
    });
    expect(onUpdate).not.toHaveBeenCalled();
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
        onUpdateDepositInfo={vi.fn()}
      />
    );

    expect(screen.getByText("已付訂金")).toBeDefined();
    expect(screen.getByText("📝 LINE Pay 轉帳")).toBeDefined();
    expect(screen.getByText(/LINE 平台已接受/)).toBeDefined();
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
        onUpdateDepositInfo={vi.fn()}
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
      expect(onUpdate).toHaveBeenCalledWith("res-test-1", false, {
        deposit_paid_on: null,
        deposit_last_five: null,
        deposit_payment_note: null,
      });
    });
  });
});
