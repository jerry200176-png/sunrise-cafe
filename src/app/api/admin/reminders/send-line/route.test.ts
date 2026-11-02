import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/job-runs", () => ({ runCronJob: vi.fn(async (_name, job) => job()) }));
vi.mock("@/lib/cron-request-auth", () => ({ authorizeCronGet: vi.fn(() => ({ ok: true })) }));
vi.mock("@/lib/send-line-reminder", () => ({ runSendLineReminder: vi.fn(async () => NextResponse.json({ ok: true })) }));
vi.mock("@/lib/reminder-trigger-source", () => ({ resolveReminderTriggerSource: vi.fn(() => "cron") }));
vi.mock("@/lib/bootstrap-migrations", () => ({ runBootstrapMigrations: vi.fn(async () => {}) }));

import { GET, POST } from "./route";
import { authorizeCronGet } from "@/lib/cron-request-auth";
import { runSendLineReminder } from "@/lib/send-line-reminder";
import { runBootstrapMigrations } from "@/lib/bootstrap-migrations";

describe("scheduled reminder route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disables informational heartbeats while preserving scheduled reminders and day deduplication", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/reminders/send-line"));
    expect(response.status).toBe(200);
    expect(runSendLineReminder).toHaveBeenCalledWith({
      force: false,
      sendHeartbeatOnEmpty: false,
      enforceDayIdempotency: true,
      trigger_source: "cron",
    });
  });

  it("does not invoke reminders or bootstrap after denied cron authentication", async () => {
    vi.mocked(authorizeCronGet).mockReturnValueOnce({ ok: false, response: NextResponse.json({}, { status: 401 }) });
    const response = await GET(new NextRequest("http://localhost/api/admin/reminders/send-line"));
    expect(response.status).toBe(401);
    expect(runBootstrapMigrations).not.toHaveBeenCalled();
    expect(runSendLineReminder).not.toHaveBeenCalled();
  });

  it("keeps manual reminders free of informational heartbeats", async () => {
    await POST(new NextRequest("http://localhost/api/admin/reminders/send-line", { method: "POST" }));
    expect(runSendLineReminder).toHaveBeenCalledWith(expect.objectContaining({
      sendHeartbeatOnEmpty: false,
      enforceDayIdempotency: false,
    }));
  });
});
