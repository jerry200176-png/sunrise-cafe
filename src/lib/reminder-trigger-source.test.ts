import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { resolveReminderTriggerSource } from "./reminder-trigger-source";

function req(headers: Record<string, string> = {}) {
  return new NextRequest("https://example.com/api/admin/reminders/send-line", { headers });
}

describe("resolveReminderTriggerSource", () => {
  it("POST is manual", () => {
    expect(resolveReminderTriggerSource(req(), "POST")).toBe("manual");
  });

  it("honors x-reminder-trigger github", () => {
    expect(
      resolveReminderTriggerSource(req({ "x-reminder-trigger": "github" }), "GET")
    ).toBe("github");
  });

  it("detects Vercel cron schedule header", () => {
    expect(
      resolveReminderTriggerSource(req({ "x-vercel-cron-schedule": "0 12 * * *" }), "GET")
    ).toBe("cron");
  });
});
