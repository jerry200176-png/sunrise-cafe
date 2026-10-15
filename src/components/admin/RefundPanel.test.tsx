/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RefundPanel } from "./RefundPanel";

const data = (viaStripe = false) => ({
  reservation: { id: "res-1", booking_code: "AB12", deposit_status: "paid", via_stripe: viaStripe },
  billing: { deposit_gross: 200, deposit_refunded: 0, deposit_refund_in_flight: true },
  refunds: [{ id: "rf-1", kind: "deposit", amount: 100, method: "transfer", status: "pending", reason: "客人取消",
    created_at: "2026-10-15T02:00:00Z", requested_by_role: "owner" }],
  events: [
    { seq: 1, refund_id: "rf-1", status: "requested", provider_ref: null, evidence_ref: null, note: null, actor: "u", actor_role: "owner", created_at: "2026-10-15T02:00:00Z" },
    { seq: 2, refund_id: "rf-1", status: "pending", provider_ref: null, evidence_ref: null, note: "已送出轉帳", actor: "u", actor_role: "branch_manager", created_at: "2026-10-15T02:05:00Z" },
  ],
  alerts: [],
});

function mockFetch(payload: unknown) {
  const posts: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") { posts.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ ok: true })); }
    return new Response(JSON.stringify(payload));
  }));
  return posts;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("RefundPanel (Founder D7)", () => {
  it("shows the in-flight block, every ledger step and the actions", async () => {
    mockFetch(data());
    render(<RefundPanel reservationId="res-1" />);
    expect(await screen.findByText(/這組暫時不能結帳/)).toBeDefined();
    const steps = screen.getByRole("list", { name: "退款每一步" });
    expect(steps.querySelectorAll("li")).toHaveLength(2);
    expect(steps.textContent).toMatch(/已送出轉帳/);
    expect(screen.getByRole("button", { name: "確認已退" })).toBeDefined();
  });

  it("requests a manual refund with a method and one idempotency key per request", async () => {
    const posts = mockFetch(data());
    render(<RefundPanel reservationId="res-1" />);
    fireEvent.change(await screen.findByLabelText("退款申請原因"), { target: { value: "客人取消" } });
    fireEvent.change(screen.getByLabelText("退款金額"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("radio", { name: "現金" }));
    fireEvent.click(screen.getByRole("button", { name: "送出退款申請" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ reservationId: "res-1", reason: "客人取消", amount: 50, method: "cash" });
    expect(String(posts[0].idempotencyKey)).toMatch(/^refund-ui:/);
  });

  it("does not ask for a method when the deposit was paid through Stripe", async () => {
    const posts = mockFetch(data(true));
    render(<RefundPanel reservationId="res-1" />);
    fireEvent.change(await screen.findByLabelText("退款申請原因"), { target: { value: "客人取消" } });
    expect(screen.queryByRole("radiogroup", { name: "退款方式" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "送出退款申請" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).not.toHaveProperty("method");
  });
});
