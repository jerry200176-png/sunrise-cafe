import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliverOnce } from "./deliver-once";

/** In-memory ledger behind the Supabase client surface deliverOnce uses. */
function ledger() {
  const rows = new Map<string, { id: string; status: "sending" | "sent" | "failed" }>();
  let n = 0;
  const client = {
    rpc: (_fn: string, a: { p_kind: string; p_reservation_id: string; p_recipient_id: string; p_event_key: string }) => ({
      maybeSingle: async () => {
        const key = [a.p_kind, a.p_reservation_id, a.p_recipient_id, a.p_event_key].join("|");
        const row = rows.get(key);
        if (!row) {
          const id = `d${++n}`;
          rows.set(key, { id, status: "sending" });
          return { data: { delivery_id: id }, error: null };
        }
        if (row.status === "failed") {
          row.status = "sending";
          return { data: { delivery_id: row.id }, error: null };
        }
        return { data: null, error: null };
      },
    }),
    from: () => ({
      update: (patch: { status: "sent" | "failed" }) => ({
        eq: async (_c: string, id: string) => {
          for (const r of rows.values()) if (r.id === id) r.status = patch.status;
          return { error: null };
        },
      }),
    }),
  };
  return { client: client as never, rows };
}

beforeEach(() => {
  delete process.env.VERCEL_ENV;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("deliverOnce", () => {
  it("sends once per (kind, reservation, recipient, eventKey)", async () => {
    const { client } = ledger();
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await deliverOnce("booking_cancelled", "r1", "U1", send, { client })).toBe("sent");
    expect(await deliverOnce("booking_cancelled", "r1", "U1", send, { client })).toBe("skipped");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a different event key, kind, or recipient is a new delivery", async () => {
    const { client } = ledger();
    const send = vi.fn().mockResolvedValue(undefined);
    await deliverOnce("booking_rescheduled", "r1", "U1", send, { client, eventKey: "a" });
    await deliverOnce("booking_rescheduled", "r1", "U1", send, { client, eventKey: "b" });
    await deliverOnce("booking_cancelled", "r1", "U1", send, { client });
    await deliverOnce("booking_cancelled", "r1", "U2", send, { client });
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("a failed push is reported, recorded, and can be claimed again", async () => {
    const { client, rows } = ledger();
    const bad = vi.fn().mockRejectedValue(new Error("LINE 500"));
    expect(await deliverOnce("k", "r1", "U1", bad, { client })).toBe("error");
    expect([...rows.values()][0].status).toBe("failed");
    const ok = vi.fn().mockResolvedValue(undefined);
    expect(await deliverOnce("k", "r1", "U1", ok, { client })).toBe("sent");
    expect(ok).toHaveBeenCalledOnce();
  });

  it("a claim stuck in sending is never re-sent automatically", async () => {
    const { client, rows } = ledger();
    await deliverOnce("k", "r1", "U1", async () => {}, { client });
    [...rows.values()][0].status = "sending";
    const send = vi.fn();
    expect(await deliverOnce("k", "r1", "U1", send, { client })).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
  });

  it("missing ledger: skip outside production, fail closed in production", async () => {
    const client = {
      rpc: () => ({ maybeSingle: async () => ({ data: null, error: { code: "PGRST202", message: "claim_line_delivery not found" } }) }),
    } as never;
    const send = vi.fn();
    expect(await deliverOnce("k", "r1", "U1", send, { client })).toBe("skipped");
    process.env.VERCEL_ENV = "production";
    await expect(deliverOnce("k", "r1", "U1", send, { client })).rejects.toThrow(/unavailable in production/);
    expect(send).not.toHaveBeenCalled();
  });
});
