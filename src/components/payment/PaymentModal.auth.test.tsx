/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
vi.mock("@stripe/react-stripe-js", () => ({ Elements: ({ children }: { children: ReactNode }) => children }));
vi.mock("@stripe/stripe-js", () => ({ loadStripe: async () => ({}) }));
vi.mock("./PaymentForm", () => ({ PaymentForm: ({ onSuccess }: { onSuccess: (id: string) => void }) => <button onClick={() => onSuccess("pi_fixture")}>simulate payment</button> }));
import { PaymentModal } from "./PaymentModal";
const fetcher = vi.fn();
beforeEach(() => { vi.clearAllMocks(); globalThis.fetch = fetcher; vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_fixture"); });
for (const token of ["signed-fixture", null]) {
  it(`passes ${token ? "token" : "booking credentials"} to both creation and confirmation`, async () => {
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ clientSecret: "fixture" }), { status: 200 }));
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ depositStatus: "paid" }), { status: 200 }));
    const complete = vi.fn();
    render(<PaymentModal open reservationId="r1" branchId="daan" amount={500} lookupToken={token} phone="0900000000" bookingCode="ABC123" onClose={() => {}} onPaymentComplete={complete} />);
    fireEvent.click(await screen.findByText("simulate payment"));
    await waitFor(() => expect(complete).toHaveBeenCalledWith("pi_fixture"));
    const auth = token ? { token } : { phone: "0900000000", bookingCode: "ABC123" };
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ reservationId: "r1", ...auth });
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ paymentIntentId: "pi_fixture", reservationId: "r1", ...auth });
  });
}

it("does not offer a new intent after confirmation times out", async () => {
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ clientSecret: "fixture" }), { status: 200 }));
  fetcher.mockRejectedValueOnce(new DOMException("timeout", "AbortError"));
  render(<PaymentModal open reservationId="r1" branchId="daan" amount={500} lookupToken="signed-fixture" phone="0900000000" bookingCode="ABC123" onClose={() => {}} onPaymentComplete={() => {}} />);
  fireEvent.click(await screen.findByText("simulate payment"));
  expect(await screen.findByText(/請勿重複付款並聯絡店家/)).toBeDefined();
  expect(screen.queryByText("重試")).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("does not offer a new intent after creation times out with unknown outcome", async () => {
  fetcher.mockRejectedValueOnce(new DOMException("timeout", "AbortError"));
  render(<PaymentModal open reservationId="r1" branchId="daan" amount={500} lookupToken="signed-fixture" phone="0900000000" bookingCode="ABC123" onClose={() => {}} onPaymentComplete={() => {}} />);
  expect(await screen.findByText(/結果尚待確認/)).toBeDefined();
  expect(screen.queryByText("重試")).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
