import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPendingPaymentEvents } from "./payment-events-admin";

const events = [
  { id: "event-a", reservation_id: "r-a", source: "bank_transfer", status: "pending_review", raw_payload: null, created_at: "2026-01-01T00:00:00Z" },
  { id: "event-b", reservation_id: "r-b", source: "bank_transfer", status: "pending_review", raw_payload: null, created_at: "2026-01-01T00:00:00Z" },
  { id: "event-unknown", reservation_id: "r-unknown", source: "bank_transfer", status: "pending_review", raw_payload: null, created_at: "2026-01-01T00:00:00Z" },
];
const reservations = [
  { id: "r-a", rooms: { branch_id: "allowed" }, customer_name: "Synthetic A", phone: "000", total_price: 100 },
  { id: "r-b", rooms: { branch_id: "foreign" }, customer_name: "Synthetic B", phone: "001", total_price: 100 },
  { id: "r-unknown", rooms: null, customer_name: "Synthetic unknown", phone: "002", total_price: 100 },
];

describe("待審付款依分店隔離", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      // Deliberately return all rows regardless of the database filter; the app must also fail closed.
      return new Response(JSON.stringify(url.pathname.endsWith("/payment_events") ? events : reservations), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("只回允許分店，未知分店及其他分店不回傳，查詢亦包含 branch filter", async () => {
    const rows = await fetchPendingPaymentEvents(["allowed"]);
    expect(rows.map((r) => r.id)).toEqual(["event-a"]);
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    const reservationUrl = new URL(urls.find((url) => url.includes("/reservations?"))!);
    expect(reservationUrl.searchParams.get("rooms.branch_id")).toBe("in.(allowed)");
    expect(reservationUrl.searchParams.get("select")).toContain("rooms!inner(branch_id)");
  });

  it("空 scope 不查資料且回空清單", async () => {
    expect(await fetchPendingPaymentEvents([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("null scope 保留 owner 看全部的既有行為", async () => {
    const rows = await fetchPendingPaymentEvents(null);
    expect(rows.map((r) => r.id)).toEqual(["event-a", "event-b", "event-unknown"]);
  });
});
