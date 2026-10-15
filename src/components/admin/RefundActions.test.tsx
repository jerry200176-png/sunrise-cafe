/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RefundActions } from "./RefundActions";

function mockFetch(status = 200, body: unknown = { ok: true }) {
  const calls: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(body), { status });
  }));
  return calls;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("RefundActions (Founder D7)", () => {
  it("confirms a transfer refund only after a reference and a note are filled in", async () => {
    const calls = mockFetch();
    const onDone = vi.fn();
    render(<RefundActions refund={{ id: "rf-1", method: "transfer", status: "pending", amount: 100 }} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "確認已退" }));
    const submit = screen.getByRole("button", { name: /送出（確認已退）/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("退款說明"), { target: { value: "已轉帳" } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("退款證據編號"), { target: { value: "TX20261015001" } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls[0]).toEqual({ refundId: "rf-1", status: "succeeded", note: "已轉帳", reference: "TX20261015001" });
  });

  it("completes a cash refund only after the operator ticks 'cash handed back' (A6-3)", async () => {
    const calls = mockFetch();
    render(<RefundActions refund={{ id: "rf-2", method: "cash", status: "requested", amount: 80 }} onDone={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "確認已退" }));
    expect(screen.queryByLabelText("退款證據編號")).toBeNull();
    fireEvent.change(screen.getByLabelText("退款說明"), { target: { value: "店長當面交給客人" } });
    const submit = screen.getByRole("button", { name: /送出（確認已退）/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("現金已交還客人"));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ status: "succeeded", note: "店長當面交給客人", cashHandedBack: true });
  });

  it("rejects a free-text reference for a transfer (A6-8)", () => {
    mockFetch();
    render(<RefundActions refund={{ id: "rf-7", method: "transfer", status: "pending", amount: 100 }} onDone={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "確認已退" }));
    fireEvent.change(screen.getByLabelText("退款說明"), { target: { value: "已轉帳" } });
    fireEvent.change(screen.getByLabelText("退款證據編號"), { target: { value: "已經轉了" } });
    expect((screen.getByRole("button", { name: /送出（確認已退）/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/格式不對/);
  });

  it("asks for the bounce reference when turning a refunded transfer into failed (A6-9)", async () => {
    const calls = mockFetch();
    render(<RefundActions refund={{ id: "rf-8", method: "transfer", status: "succeeded", amount: 100 }} onDone={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "標記失敗" }));
    fireEvent.change(screen.getByLabelText("退款原因"), { target: { value: "銀行退回" } });
    const submit = screen.getByRole("button", { name: /送出（標記失敗）/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("退款證據編號"), { target: { value: "RT20261016001" } });
    fireEvent.click(submit);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ status: "failed", reference: "RT20261016001" });
  });

  it("offers no action on a handed-back cash refund, and none to read-only viewers", () => {
    const { container, rerender } = render(<RefundActions refund={{ id: "rf-9", method: "cash", status: "succeeded", amount: 1 }} onDone={() => undefined} />);
    expect(container.textContent).toBe("");
    rerender(<RefundActions refund={{ id: "rf-9", method: "transfer", status: "pending", amount: 1 }} canAct={false} onDone={() => undefined} />);
    expect(container.textContent).toBe("");
  });

  it.each([["標記失敗", "failed"], ["取消退款", "canceled"]])("requires a reason to %s", async (label, status) => {
    const calls = mockFetch();
    render(<RefundActions refund={{ id: "rf-3", method: "line_pay", status: "pending", amount: 50 }} onDone={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    const submit = screen.getByRole("button", { name: new RegExp(`送出（${label}）`) }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("退款原因"), { target: { value: "客人改要留抵" } });
    fireEvent.click(submit);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ status, note: "客人改要留抵" });
  });

  it("offers a Stripe refund only reconcile — no confirm, fail or cancel", async () => {
    const calls = mockFetch();
    render(<RefundActions refund={{ id: "rf-4", method: "stripe", status: "requested", amount: 200 }} onDone={() => undefined} />);
    expect(screen.queryByRole("button", { name: "確認已退" })).toBeNull();
    expect(screen.queryByRole("button", { name: "取消退款" })).toBeNull();
    expect(screen.queryByRole("button", { name: "標記失敗" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "向 Stripe 對帳" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ refundId: "rf-4", reconcile: true });
  });

  it("shows the server's refusal and keeps the form", async () => {
    mockFetch(403, { error: "退款要請老闆或這間分店的店長操作" });
    const onDone = vi.fn();
    render(<RefundActions refund={{ id: "rf-5", method: "transfer", status: "pending", amount: 100 }} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "取消退款" }));
    fireEvent.change(screen.getByLabelText("退款原因"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /送出（取消退款）/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/老闆/);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("renders nothing for a finished refund", () => {
    const { container } = render(<RefundActions refund={{ id: "rf-6", method: "transfer", status: "canceled", amount: 1 }} onDone={() => undefined} />);
    expect(container.textContent).toBe("");
  });
});
