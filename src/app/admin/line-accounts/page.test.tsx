// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/line-accounts", useRouter: () => ({ push: vi.fn() }) }));

import LineAccountsPage from "./page";

const account = (over: Record<string, unknown>) => ({ role: "group", source: "LINE_CHANNEL_ACCESS_TOKEN", configured: true,
  displayName: "提醒小幫手", basicId: "@111", error: null,
  usage: { status: "complete", monthUsed: 190, monthLimit: 200, planType: "limited", todayPush: 3, level: "critical", percentUsed: 95 }, ...over });

function serve(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("/admin/line-accounts", () => {
  it("does not claim the accounts differ when an identity lookup failed", async () => {
    serve({ fetchedAt: "2026-10-21T00:00:00Z", collisions: [], identityComplete: false, accounts: [
      account({}),
      account({ role: "customer", source: "LINE_CUSTOMER_ACCESS_TOKEN", displayName: null, basicId: null, error: "token 無效或已過期（LINE 回 401）", usage: null }),
    ] });
    render(<LineAccountsPage />);
    expect(await screen.findByText(/有帳號讀不到身分/)).toBeTruthy();
    expect(screen.queryByText(/用的是不同的 LINE 帳號/)).toBeNull();
    expect(screen.getByText("已用 95%").className).toContain("text-rose-700");
  });

  it("shows the green banner only when every identity resolved and none collide", async () => {
    serve({ fetchedAt: "2026-10-21T00:00:00Z", collisions: [], identityComplete: true, accounts: [account({})] });
    render(<LineAccountsPage />);
    expect(await screen.findByText(/用的是不同的 LINE 帳號/)).toBeTruthy();
  });

  it("shows the collision warning", async () => {
    serve({ fetchedAt: "2026-10-21T00:00:00Z", identityComplete: true, accounts: [account({})],
      collisions: [{ customerSource: "LINE_CUSTOMER_ACCESS_TOKEN", groupSource: "LINE_CHANNEL_ACCESS_TOKEN", displayName: "提醒小幫手", basicId: "@111" }] });
    render(<LineAccountsPage />);
    expect(await screen.findByText(/客人通知用的是店員群組的帳號/)).toBeTruthy();
  });
});
