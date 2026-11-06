import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  fetchHead: vi.fn(), fetchVersion: vi.fn(), bootstrap: vi.fn(), audit: vi.fn(),
  send: vi.fn(), notifyFailure: vi.fn(), logOps: vi.fn(), recordMismatch: vi.fn(),
}));
vi.mock("@/lib/expected-main-head", () => ({ fetchExpectedMainHead: mocks.fetchHead }));
vi.mock("@/lib/production-version", () => ({ fetchProductionVersion: mocks.fetchVersion }));
vi.mock("@/lib/bootstrap-migrations", () => ({ runBootstrapMigrations: mocks.bootstrap }));
vi.mock("@/lib/line-account-audit", () => ({ checkLineAccountsAndAlert: mocks.audit }));
vi.mock("@/lib/line-notify", () => ({ isLineConfigured: () => true, sendLineMessage: mocks.send }));
vi.mock("@/lib/supabase-admin", () => ({ isAdminConfigured: () => false }));
vi.mock("@/lib/cron-alert", () => ({
  notifyCronFailure: mocks.notifyFailure,
  errorToDetail: (err: unknown) => err instanceof Error ? err.message : String(err),
}));
vi.mock("@/lib/ops-log", () => ({ logOps: mocks.logOps }));
vi.mock("@/lib/deploy-alert", () => ({ recordDeployMismatch: mocks.recordMismatch }));
vi.mock("@/lib/cron-request-auth", () => ({ authorizeCronGet: () => ({ ok: true }) }));

import { GET, POST } from "./route";
import { NextResponse } from "next/server";
import { runCronJob } from "@/lib/job-runs";

const request = () => new NextRequest("http://localhost/api/admin/reminders/deploy-health");

describe("deployment health messaging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchHead.mockResolvedValue({ sha: "aaaaaaaaaaaaaaaa", runtimeChanged: true });
    mocks.fetchVersion.mockResolvedValue({ reachable: true, commit: "bbbbbbbbbbbbbbbb", commit_short: "bbbbbbb" });
    mocks.bootstrap.mockResolvedValue(undefined);
    mocks.audit.mockResolvedValue(undefined);
  });

  it.each(["GET", "POST"] as const)("%s records mismatches without messaging the group", async (method) => {
    const res = method === "GET" ? await GET(request()) : await POST();
    expect(await res.json()).toMatchObject({ ok: false, sha_parity: false, alerted: false });
    expect(mocks.recordMismatch).toHaveBeenCalledOnce();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.notifyFailure).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledOnce();
  });

  it.each(["GET", "POST"] as const)("%s records source failures without a cron group alert", async (method) => {
    mocks.fetchHead.mockResolvedValue(null);
    const res = method === "GET" ? await GET(request()) : await POST();
    expect(res.status).toBe(503);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.notifyFailure).not.toHaveBeenCalled();
    expect(mocks.logOps).toHaveBeenCalledWith("cron", "cron.run_failed", expect.objectContaining({ job_name: "deploy-health" }));
  });

  it("keeps customer/staff account collision alerts enabled", async () => {
    mocks.audit.mockImplementationOnce(async (notify: (text: string) => Promise<void>) => notify("account collision"));
    await GET(request());
    expect(mocks.send).toHaveBeenCalledWith("account collision");
  });

  it("still notifies failures for other business cron jobs by default", async () => {
    const res = await runCronJob("deposit-deadline", async () => NextResponse.json({ error: "failed" }, { status: 503 }));
    expect(res.status).toBe(503);
    expect(mocks.notifyFailure).toHaveBeenCalledWith("deposit-deadline", expect.any(String));
  });

  it("records unexpected wrapper errors without a suppressed cron notification", async () => {
    const res = await runCronJob("deploy-health", async () => { throw new Error("synthetic failure"); }, { notifyFailure: false });
    expect(res.status).toBe(500);
    expect(mocks.notifyFailure).not.toHaveBeenCalled();
    expect(mocks.logOps).toHaveBeenCalledWith("cron", "cron.run_failed", expect.objectContaining({ job_name: "deploy-health" }));
  });
});
