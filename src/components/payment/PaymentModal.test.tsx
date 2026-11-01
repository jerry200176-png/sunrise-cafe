/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PaymentModal } from "./PaymentModal";

// Mock fetch for create-intent API
const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = mockFetch;
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_fake");
});

describe("PaymentModal", () => {
  const baseProps = {
    open: true,
    reservationId: "res-001",
    branchId: "daan",
    amount: 500,
    lookupToken: "signed-fixture",
    phone: "0900000000",
    bookingCode: "ABC123",
    onClose: vi.fn(),
    onPaymentComplete: vi.fn(),
  };

  it("renders loading state when open", () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ clientSecret: "pi_secret_test" }), {
        status: 200,
      })
    );
    render(<PaymentModal {...baseProps} />);
    expect(screen.getByText("建立安全付款連線中…")).toBeDefined();
  });

  it("calls create-intent API on mount", () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ clientSecret: "pi_secret_test" }), {
        status: 200,
      })
    );
    render(<PaymentModal {...baseProps} />);
    expect(mockFetch).toHaveBeenCalledWith("/api/payment/create-intent", {
      method: "POST",
      signal: expect.any(AbortSignal),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reservationId: "res-001",
        branchId: "daan",
        amount: 500,
        token: "signed-fixture",
      }),
    });
  });

  it("uses the booking credentials when no lookup token is available", () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ clientSecret: "pi_secret_test" }), { status: 200 }));
    render(<PaymentModal {...baseProps} lookupToken={null} />);
    const request = mockFetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual({
      reservationId: "res-001", branchId: "daan", amount: 500,
      phone: "0900000000", bookingCode: "ABC123",
    });
  });

  it("shows error state when API fails", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "付款失敗" }), { status: 400 })
    );
    render(<PaymentModal {...baseProps} />);
    const errorText = await screen.findByText("付款失敗");
    expect(errorText).toBeDefined();
  });

  it("renders nothing when open is false", () => {
    render(<PaymentModal {...baseProps} open={false} />);
    expect(screen.queryByText("支付訂金")).toBeNull();
  });

  it("has close button", () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ clientSecret: "pi_secret_test" }), {
        status: 200,
      })
    );
    render(<PaymentModal {...baseProps} />);
    const closeBtn = screen.getByLabelText("關閉");
    expect(closeBtn).toBeDefined();
  });
});
