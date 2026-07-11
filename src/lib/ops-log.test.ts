import { describe, it, expect, vi, afterEach } from "vitest";
import { logOps } from "@/lib/ops-log";

describe("logOps", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits JSON with cron.completed action", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logOps("cron", "cron.completed", { job_name: "send-line", items_processed: 3 });
    expect(spy).toHaveBeenCalledOnce();
    const line = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.domain).toBe("cron");
    expect(parsed.action).toBe("cron.completed");
    expect(parsed.job_name).toBe("send-line");
    expect(parsed.items_processed).toBe(3);
    expect(parsed.ts).toBeDefined();
  });

  it("emits webhook.event_ok action", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logOps("webhook", "webhook.event_ok", { route: "line", event_count: 2 });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.domain).toBe("webhook");
    expect(parsed.action).toBe("webhook.event_ok");
    expect(parsed.route).toBe("line");
    expect(parsed.event_count).toBe(2);
  });

  it("emits guest.lookup_denied_rate_limit action", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logOps("guest", "guest.lookup_denied_rate_limit", { path: "/api/my-bookings", limiter: "guestLookup" });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.action).toBe("guest.lookup_denied_rate_limit");
    expect(parsed.path).toBe("/api/my-bookings");
  });

  it("emits webhook.event_handled action", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logOps("webhook", "webhook.event_handled", {
      route: "line",
      msg_type: "image",
      event_type: "message",
    });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.action).toBe("webhook.event_handled");
    expect(parsed.msg_type).toBe("image");
  });
});
