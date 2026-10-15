/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RefundPanel } from "./RefundPanel";

const data = (viaStripe = false, canAct = true) => ({
  viewer: { role: canAct ? "owner" : "finance", can_act: canAct },
  obligations: [] as unknown[],
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
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "退款方式" })).getByRole("radio", { name: "現金" }));
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

  it("is read-only for finance: no actions, no request or off-system forms (A6-1)", async () => {
    mockFetch(data(false, false));
    render(<RefundPanel reservationId="res-1" />);
    expect(await screen.findByText(/唯讀/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "確認已退" })).toBeNull();
    expect(screen.queryByRole("button", { name: "送出退款申請" })).toBeNull();
    expect(screen.queryByText(/系統外退款補登/)).toBeNull();
    expect(screen.getByRole("list", { name: "退款每一步" })).toBeDefined();
  });

  it("keeps a deposit difference still owed on screen and offers a follow-up refund (A6-9)", async () => {
    const payload = { ...data(), obligations: [{ settlement_id: "st-1", owed: 100, refunded: 0, in_flight: 0, unrequested: 100 }] };
    const posts = mockFetch(payload);
    render(<RefundPanel reservationId="res-1" />);
    expect(await screen.findByText("還欠客人的訂金差額")).toBeDefined();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "補退方式" })).getByRole("radio", { name: "轉帳" }));
    fireEvent.click(screen.getByRole("button", { name: /申請補退 NT\$ 100/ }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ reservationId: "res-1", kind: "checkout_deposit_excess", amount: 100, method: "transfer" });
  });

  it("records an off-system refund only with a reason and a valid reference (A6-2)", async () => {
    const posts = mockFetch(data());
    render(<RefundPanel reservationId="res-1" />);
    fireEvent.click(await screen.findByText(/系統外退款補登/));
    const submit = screen.getByRole("button", { name: "補登已完成的退款" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("補登金額"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("補登原因"), { target: { value: "人工核對：舊結帳沒折抵訂金" } });
    fireEvent.change(screen.getByLabelText("補登交易編號"), { target: { value: "已轉帳" } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("補登交易編號"), { target: { value: "TX20261015123" } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ offSystem: true, amount: 100, method: "transfer", reference: "TX20261015123" });
    expect(String(posts[0].idempotencyKey)).toMatch(/^refund-offsystem:/);
  });

  it("lets a manager take an unacknowledged alert with a note (A6-4)", async () => {
    const payload = { ...data(), alerts: [{ id: "al-1", reservation_id: "res-1", kind: "provider_outcome_unknown",
      created_at: "2026-10-15T02:00:00Z", acknowledged_at: null }] };
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") { calls.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ ok: true })); }
      return new Response(JSON.stringify(payload));
    }));
    render(<RefundPanel reservationId="res-1" />);
    expect(await screen.findByText(/還沒有人負責/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "認領這個警示" }));
    fireEvent.change(screen.getByLabelText("認領說明"), { target: { value: "我去 Stripe 後台查" } });
    fireEvent.click(screen.getByRole("button", { name: "由我負責" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ alertId: "al-1", acknowledge: true, note: "我去 Stripe 後台查" });
  });
});
