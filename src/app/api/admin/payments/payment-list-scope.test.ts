import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSignedAdminSession } from "@/lib/admin-api-auth";
import { GET as pending } from "./pending/route";
import { GET as reconcileGet, POST as reconcilePost } from "./reconcile/route";

async function req(role: "finance" | "staff" | "owner" | null, csv = false, scope: string[] | null = ["allowed"]) {
  const cookie = role ? `admin_session=${await createSignedAdminSession("test-session", 3600, { role, sub: "test", branch_ids: role === "owner" ? null : scope })}` : "";
  const form = new FormData();
  if (csv) form.append("file", new Blob(["date,amount,remark\n2026-01-01,50,12345\n2026-01-01,100,12345"]), "synthetic.csv");
  return new NextRequest("http://localhost/test", { method: csv ? "POST" : "GET", headers: { cookie }, ...(csv ? { body: form } : {}) });
}
const reservations = [
  { id: "a", booking_code: "A", customer_name: "Synthetic A", phone: "000", rooms: { branch_id: "allowed" }, total_price: 100, deposit_payment_note: "12345", created_at: "2026-01-01T00:00:00Z", start_time: "2026-02-01T00:00:00Z", status: "pending" },
  { id: "b", booking_code: "B", customer_name: "Synthetic B", phone: "001", rooms: { branch_id: "foreign" }, total_price: 200, deposit_payment_note: "12345", created_at: "2026-01-01T00:00:00Z", start_time: "2026-02-01T00:00:00Z", status: "pending" },
  { id: "unknown", booking_code: "U", customer_name: "Synthetic unknown", phone: "002", rooms: null, total_price: 200, deposit_payment_note: "12345", created_at: "2026-01-01T00:00:00Z", start_time: "2026-02-01T00:00:00Z", status: "pending" },
];
const events = reservations.map((r) => ({ id: `event-${r.id}`, reservation_id: r.id, status: "pending_review", raw_payload: null, source: "bank_transfer", created_at: "2026-01-01T00:00:00Z" }));
describe("待審清單及對帳按分店隔離", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv("ADMIN_PASSWORD", "test-admin"); vi.stubEnv("SESSION_SECRET", "test-session");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key");
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const body = url.pathname.endsWith("/payment_events") ? events : reservations;
      // Simulate a backend returning too many rows to check the app's fail-closed filter.
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it.each([["pending", pending], ["reconcile GET", reconcileGet]] as const)("%s 驗證角色、分店、空 scope 及 owner", async (_, action) => {
    expect((await action(await req(null))).status).toBe(401);
    expect((await action(await req("staff"))).status).toBe(403);
    const response = await action(await req("finance"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Synthetic A"); expect(text).not.toContain("Synthetic B"); expect(text).not.toContain("Synthetic unknown");
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => new URL(url).searchParams.get("rooms.branch_id") === "in.(allowed)")).toBe(true);
    fetchMock.mockClear();
    const empty = await action(await req("finance", false, []));
    expect(empty.status).toBe(200); expect(fetchMock).not.toHaveBeenCalled();
    const owner = await action(await req("owner"));
    expect(await owner.text()).toContain("Synthetic B");
  });
  it("POST 對帳只配對已授權分店、空 scope 不查資料，owner 可配對全部", async () => {
    expect((await reconcilePost(await req("staff", true))).status).toBe(403);
    const res = await reconcilePost(await req("finance", true));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Synthetic A"); expect(text).not.toContain("Synthetic B"); expect(text).not.toContain("Synthetic unknown");
    fetchMock.mockClear();
    expect((await reconcilePost(await req("finance", true, []))).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await (await reconcilePost(await req("owner", true))).text()).toContain("Synthetic B");
  });
});
