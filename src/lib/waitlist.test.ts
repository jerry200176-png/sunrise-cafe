import { describe, expect, it, vi, beforeEach } from "vitest";

const fromMock = vi.fn();
const sendLineFlexMessage = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: (...args: unknown[]) => fromMock(...args) }),
}));

vi.mock("@/lib/line", () => ({
  sendLineFlexMessage: (...args: unknown[]) => sendLineFlexMessage(...args),
}));

vi.mock("@/lib/line-cards", () => ({
  buildWaitlistFlex: () => ({ type: "bubble" }),
  WAITLIST_CONFIRM_WINDOW_MINUTES: 30,
}));

function chain(data: unknown) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  for (const m of ["select", "eq", "not", "lt", "gt", "order", "limit", "update"]) {
    c[m] = vi.fn(self);
  }
  c.then = undefined;
  // terminal thenables used as awaitables: supabase returns promise-like
  return Object.assign(c, {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ data, error: null })),
  });
}

describe("notifyWaitlist", () => {
  beforeEach(() => {
    vi.resetModules();
    fromMock.mockReset();
    sendLineFlexMessage.mockReset();
  });

  it("does not mark notified when guest has no LINE user id", async () => {
    const updates: unknown[] = [];
    fromMock.mockImplementation((table: string) => {
      if (table === "waitlist") {
        const q = chain([
          {
            id: "w1",
            customer_name: "A",
            phone: "0911111111",
            start_time: "2026-07-16T10:00:00+08:00",
            end_time: "2026-07-16T12:00:00+08:00",
            confirm_token: "tok",
          },
        ]);
        q.update = vi.fn((payload: unknown) => {
          updates.push(payload);
          return chain(null);
        });
        return q;
      }
      // reservations → no line bind
      return chain([]);
    });

    const { notifyWaitlist } = await import("./waitlist");
    const result = await notifyWaitlist(
      "room1",
      "2026-07-16T10:00:00+08:00",
      "2026-07-16T12:00:00+08:00"
    );
    expect(result.outcome).toBe("no_line");
    expect(updates).toHaveLength(0);
    expect(sendLineFlexMessage).not.toHaveBeenCalled();
  });

  it("marks notified only after LINE push succeeds", async () => {
    const updates: unknown[] = [];
    sendLineFlexMessage.mockResolvedValue(undefined);
    fromMock.mockImplementation((table: string) => {
      if (table === "waitlist") {
        const q = chain([
          {
            id: "w1",
            customer_name: "A",
            phone: "0911111111",
            start_time: "2026-07-16T10:00:00+08:00",
            end_time: "2026-07-16T12:00:00+08:00",
            confirm_token: "tok",
          },
        ]);
        q.update = vi.fn((payload: unknown) => {
          updates.push(payload);
          return chain(null);
        });
        return q;
      }
      return chain([{ line_user_id: "U123" }]);
    });

    const { notifyWaitlist } = await import("./waitlist");
    const result = await notifyWaitlist(
      "room1",
      "2026-07-16T10:00:00+08:00",
      "2026-07-16T12:00:00+08:00"
    );
    expect(result.outcome).toBe("notified");
    expect(sendLineFlexMessage).toHaveBeenCalledOnce();
    expect(updates[0]).toMatchObject({ status: "notified" });
  });

  it("leaves waiting when LINE push fails", async () => {
    const updates: unknown[] = [];
    sendLineFlexMessage.mockRejectedValue(new Error("LINE down"));
    fromMock.mockImplementation((table: string) => {
      if (table === "waitlist") {
        const q = chain([
          {
            id: "w1",
            customer_name: "A",
            phone: "0911111111",
            start_time: "2026-07-16T10:00:00+08:00",
            end_time: "2026-07-16T12:00:00+08:00",
            confirm_token: "tok",
          },
        ]);
        q.update = vi.fn((payload: unknown) => {
          updates.push(payload);
          return chain(null);
        });
        return q;
      }
      return chain([{ line_user_id: "U123" }]);
    });

    const { notifyWaitlist } = await import("./waitlist");
    const result = await notifyWaitlist(
      "room1",
      "2026-07-16T10:00:00+08:00",
      "2026-07-16T12:00:00+08:00"
    );
    expect(result.outcome).toBe("line_failed");
    expect(updates).toHaveLength(0);
  });
});
