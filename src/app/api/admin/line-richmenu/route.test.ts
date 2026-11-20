import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ requirePermission: vi.fn(), publish: vi.fn(async () => "richmenu-1"), remove: vi.fn(async () => {}) }));
vi.mock("@/lib/admin-api-auth", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/line-richmenu", () => ({ publishRichMenu: mocks.publish, removeRichMenu: mocks.remove }));

import { POST } from "./route";

const STORE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const USER = "U" + "a".repeat(32);
const post = (body: unknown) => POST(new NextRequest("http://localhost/api/admin/line-richmenu", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePermission.mockResolvedValue(null);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubEnv("LINE_CUSTOMER_ACCESS_TOKEN", "default-token");
  vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "staff-group-token");
  vi.stubEnv("LINE_BRANCH_CUSTOMER_BOTS", JSON.stringify([{ branch_id: STORE, name: "同德店", secret: "s", token: "store-token" }]));
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/admin/line-richmenu", () => {
  it("is owner-only (line:audit) and does not call LINE when denied", async () => {
    mocks.requirePermission.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    expect((await post({ action: "publish" })).status).toBe(403);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "line:audit");
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("publishes to one user for a trial, or to everyone, on the default customer account", async () => {
    expect(await (await post({ action: "publish", userId: USER })).json()).toMatchObject({ ok: true, scope: "user", richMenuId: "richmenu-1" });
    expect(mocks.publish).toHaveBeenLastCalledWith("default-token", USER);
    expect(await (await post({ action: "publish" })).json()).toMatchObject({ ok: true, scope: "all" });
    expect(mocks.publish).toHaveBeenLastCalledWith("default-token", undefined);
  });

  it("uses a store's own account, and never another account for a store without one", async () => {
    await post({ action: "remove", branchId: STORE });
    expect(mocks.remove).toHaveBeenCalledWith("store-token", undefined);
    const res = await post({ action: "publish", branchId: "99999999-bbbb-4ccc-8ddd-eeeeeeeeeeee" });
    expect(res.status).toBe(400);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("rejects unknown actions and malformed user ids before calling LINE", async () => {
    expect((await post({ action: "delete-all" })).status).toBe(400);
    expect((await post({ action: "publish", userId: "all" })).status).toBe(400);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("reports a LINE failure as 502 with the short reason only", async () => {
    mocks.publish.mockRejectedValueOnce(new Error("LINE POST /v2/bot/richmenu → 401"));
    const res = await post({ action: "publish" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "LINE POST /v2/bot/richmenu → 401" });
  });
});
