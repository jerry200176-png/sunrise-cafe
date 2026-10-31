import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSignedAdminSession } from "@/lib/admin-api-auth";

const mocks = vi.hoisted(() => ({ approve: vi.fn(), reject: vi.fn(), refund: vi.fn(), line: vi.fn() }));
vi.mock("@/lib/payment-events-admin", () => ({ approvePaymentEvent: mocks.approve, rejectPaymentEvent: mocks.reject }));
vi.mock("@/lib/stripe", () => ({ isStripeEnabled: () => true, stripe: { refunds: { create: mocks.refund } } }));
vi.mock("@/lib/line-content", () => ({ fetchLineMessageContent: mocks.line }));
vi.mock("@/lib/ops-log", () => ({ logOps: vi.fn() }));
import { POST as approve } from "./[id]/approve/route";
import { POST as reject } from "./[id]/reject/route";
import { GET as image } from "./[id]/image/route";
import { POST as refund } from "@/app/api/payment/refund/route";

async function req(role: "finance" | "staff" | "owner" | null, method = "POST", scope: string[] | null = ["allowed"], body = {}) {
  const cookie = role ? `admin_session=${await createSignedAdminSession("test-session", 3600, { role, sub: "test", branch_ids: role === "owner" ? null : scope })}` : "";
  return new NextRequest("http://localhost/test", { method, headers: { cookie, "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("付款審核、截圖與退款按分店授權", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv("ADMIN_PASSWORD", "test-admin"); vi.stubEnv("SESSION_SECRET", "test-session");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key");
    vi.clearAllMocks();
    mocks.approve.mockResolvedValue({ already_processed: false, notification: null });
    mocks.reject.mockResolvedValue({ already_processed: false });
    mocks.refund.mockResolvedValue({ id: "synthetic-refund", status: "succeeded" });
    mocks.line.mockResolvedValue({ body: new Uint8Array([1]), contentType: "image/jpeg" });
    fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const id = url.searchParams.get("id")?.replace(/^eq\./, "") ?? "";
      let data: unknown = {};
      if (url.pathname.endsWith("/payment_events")) {
        data = url.searchParams.get("select") === "reservation_id" ? (id === "missing" ? null : { reservation_id: id }) : { source: "line_image", raw_payload: JSON.stringify({ kind: "line_image", line_message_id: "synthetic" }), reservation_id: id };
      } else if (url.pathname.endsWith("/reservations") && url.searchParams.get("select")?.includes("rooms!inner")) {
        data = id === "missing" ? null : { rooms: id === "unknown" ? null : { branch_id: id === "same" ? "allowed" : "foreign" } };
      } else if (url.pathname.endsWith("/reservations") && init?.method !== "PATCH") {
        data = { id, payment_intent_id: "pi_synthetic", deposit_status: "paid", booking_code: "TEST" };
      }
      return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it.each([["approve", approve], ["reject", reject]] as const)("%s 不登入、無權角色、外店及未知歸屬均不寫入", async (_, action) => {
    expect((await action(await req(null), params("same"))).status).toBe(401);
    expect((await action(await req("staff"), params("same"))).status).toBe(403);
    for (const id of ["foreign", "unknown", "missing"]) expect((await action(await req("finance"), params(id))).status).toBe(404);
    expect((await action(await req("finance", "POST", []), params("same"))).status).toBe(404);
    expect(mocks.approve).not.toHaveBeenCalled(); expect(mocks.reject).not.toHaveBeenCalled();
  });
  it.each([["approve", approve, mocks.approve], ["reject", reject, mocks.reject]] as const)("%s 允許同店與 owner", async (_, action, write) => {
    expect((await action(await req("finance"), params("same"))).status).toBe(200);
    expect((await action(await req("owner"), params("foreign"))).status).toBe(200);
    expect(write).toHaveBeenCalledTimes(2);
  });
  it("外店與未知付款截圖不呼叫 LINE；沒有讀取權限返回 403", async () => {
    expect((await image(await req("staff", "GET"), params("same"))).status).toBe(403);
    for (const id of ["foreign", "unknown", "missing"]) expect((await image(await req("finance", "GET"), params(id))).status).toBe(404);
    expect(mocks.line).not.toHaveBeenCalled();
  });
  it("同店與 owner 可讀取付款截圖", async () => {
    expect((await image(await req("finance", "GET"), params("same"))).status).toBe(200);
    expect((await image(await req("owner", "GET"), params("foreign"))).status).toBe(200);
    expect(mocks.line).toHaveBeenCalledTimes(2);
  });
  it("外店退款、未知歸屬及空 scope 在 Stripe 和資料寫入之前拒絕", async () => {
    for (const id of ["foreign", "unknown", "missing"]) expect((await refund(await req("finance", "POST", ["allowed"], { reservationId: id }))).status).toBe(404);
    expect((await refund(await req("finance", "POST", [], { reservationId: "same" }))).status).toBe(404);
    expect((await refund(await req("staff", "POST", ["allowed"], { reservationId: "same" }))).status).toBe(403);
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });
  it("同店與 owner 可退款", async () => {
    expect((await refund(await req("finance", "POST", ["allowed"], { reservationId: "same" }))).status).toBe(200);
    expect((await refund(await req("owner", "POST", null, { reservationId: "foreign" }))).status).toBe(200);
    expect(mocks.refund).toHaveBeenCalledTimes(2);
  });
});
