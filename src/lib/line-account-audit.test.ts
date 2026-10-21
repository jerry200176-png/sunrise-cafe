import { afterEach, expect, it, vi } from "vitest";
import { auditLineAccounts } from "./line-account-audit";
vi.mock("./line-usage", () => ({ fetchLineQuotaAudit: vi.fn(async () => ({ status: "complete", snapshot: { used: 0, limit: 200 }, endpoints: { quota: { available: true } } })) }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("audits group and customer identities independently without sends or secret output", async () => {
  vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "secret-group");
  vi.stubEnv("LINE_CUSTOMER_ACCESS_TOKEN", "secret-customer");
  vi.stubEnv("LINE_EXTRA_GROUP_BOTS", "");
  vi.stubEnv("LINE_BRANCH_CUSTOMER_BOTS", "");
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => (init.headers as Record<string, string>).Authorization.includes("group")
    ? new Response("sensitive-error", { status: 401 })
    : Response.json({ displayName: "Customer OA", basicId: "@customer", userId: "private-user-id" }));
  vi.stubGlobal("fetch", fetcher);
  const result = await auditLineAccounts();
  expect(result[0]).toMatchObject({ role: "group", identity: { status: 401 } });
  expect(result[1]).toMatchObject({ role: "customer", identity: { status: 200, name: "Customer OA" } });
  expect(fetcher.mock.calls.every(([url, init]) => url === "https://api.line.me/v2/bot/info" && init.method === "GET")).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/secret-|sensitive-error|private-user-id/);
});
it("reports missing credentials without invoking the provider", async () => {
  for (const key of ["LINE_CHANNEL_ACCESS_TOKEN", "LINE_CUSTOMER_ACCESS_TOKEN", "LINE_EXTRA_GROUP_BOTS", "LINE_BRANCH_CUSTOMER_BOTS"]) vi.stubEnv(key, "");
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await auditLineAccounts()).toEqual([
    { role: "group", scope: "default", configured: false },
    { role: "customer", scope: "default", configured: false },
  ]);
  expect(fetcher).not.toHaveBeenCalled();
});
