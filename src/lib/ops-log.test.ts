import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logOps } from "@/lib/ops-log";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  configured: vi.fn(),
  createClient: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/supabase-admin", () => ({ isAdminConfigured: mocks.configured }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

async function runScheduledPersistence() {
  const callback = mocks.after.mock.calls[0]?.[0] as (() => Promise<void>) | undefined;
  if (!callback) throw new Error("Expected lifecycle callback");
  await callback();
}

describe("logOps", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    mocks.after.mockReset();
    mocks.configured.mockReset();
    mocks.configured.mockReturnValue(true);
    mocks.insert.mockReset();
    mocks.insert.mockResolvedValue({ error: null });
    mocks.createClient.mockReset().mockReturnValue({
      from: () => ({ insert: mocks.insert }),
    });
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

  it("schedules persistence after the response without awaiting it", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schedule = vi.fn<(work: () => Promise<void>) => void>();
    logOps("cron", "cron.completed", { job_name: "send-line" }, schedule);

    expect(spy).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledOnce();
    expect(mocks.insert).not.toHaveBeenCalled();
    await schedule.mock.calls[0][0]();
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });

  it("reports missing configuration without attempting a write", async () => {
    mocks.configured.mockReturnValue(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logOps("guest", "guest.booking_created", { reservation_id: "private-id" });
    await runScheduledPersistence();

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('"reason":"not_configured"');
    expect(warn.mock.calls[0][0]).not.toContain("private-id");
  });

  it("treats a missing Supabase URL as missing configuration", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    logOps("guest", "guest.booking_created", {});
    await runScheduledPersistence();

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain('"reason":"not_configured"');
  });

  it("persists the event on the normal path", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logOps("webhook", "webhook.event_ok", { route: "line" });
    await runScheduledPersistence();

    expect(mocks.insert).toHaveBeenCalledWith({
      domain: "webhook",
      action: "webhook.event_ok",
      detail: { route: "line" },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["PGRST205", "Could not find ops_events in schema cache"],
    ["42P01", "relation ops_events does not exist"],
  ])("classifies missing table error code %s", async (code, message) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.insert.mockResolvedValue({ error: { code, message } });
    logOps("webhook", "webhook.event_ok", {});
    await runScheduledPersistence();

    expect(warn.mock.calls[0][0]).toContain('"reason":"missing_table"');
    expect(warn.mock.calls[0][0]).not.toContain(message);
  });

  it("reports a rejected insert even when its message mentions the table", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.insert.mockResolvedValue({
      error: { code: "42501", message: "ops_events denied for customer secret-value" },
    });
    logOps("payment", "payment.deposit_confirmed", { customer: "private-name" });
    await runScheduledPersistence();

    expect(warn.mock.calls[0][0]).toContain('"reason":"rejected"');
    expect(warn.mock.calls[0][0]).not.toContain("secret-value");
    expect(warn.mock.calls[0][0]).not.toContain("private-name");
  });

  it("treats an explicit HTTP permission response as rejected", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.insert.mockResolvedValue({
      error: { code: "", message: "permission denied" },
      status: 403,
    });
    logOps("admin", "admin.payment_approved", {});
    await runScheduledPersistence();

    expect(warn.mock.calls[0][0]).toContain('"reason":"rejected"');
  });

  it("treats a database constraint violation as rejected", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.insert.mockResolvedValue({
      error: { code: "23505", message: "duplicate key contains private data" },
      status: 409,
    });
    logOps("payment", "payment.deposit_confirmed", {});
    await runScheduledPersistence();

    expect(warn.mock.calls[0][0]).toContain('"reason":"rejected"');
    expect(warn.mock.calls[0][0]).not.toContain("private data");
  });

  it("treats a generic server response as unknown outcome", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.insert.mockResolvedValue({
      error: { code: "", message: "upstream error with private data" },
      status: 502,
    });
    logOps("webhook", "webhook.event_ok", {});
    await runScheduledPersistence();

    expect(warn.mock.calls[0][0]).toContain('"reason":"outcome_unknown"');
    expect(warn.mock.calls[0][0]).not.toContain("private data");
  });

  it("classifies database timeouts separately", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.insert.mockRejectedValue(new Error("request timed out with token secret-value"));
    logOps("cron", "cron.run_failed", {});
    await runScheduledPersistence();

    expect(warn.mock.calls[0][0]).toContain('"reason":"timeout_outcome_unknown"');
    expect(warn.mock.calls[0][0]).not.toContain("secret-value");
  });

  it("aborts the insert fetch at its deadline and reports an unknown outcome", async () => {
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    mocks.createClient.mockImplementation((_url, _key, options) => ({
      from: () => ({
        insert: () => options.global.fetch("https://db.example.test/rest/v1/ops_events", {}),
      }),
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logOps("cron", "cron.completed", {});
    await runScheduledPersistence();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(true);
    expect(warn.mock.calls[0][0]).toContain('"event":"ops_events.persistence_issue"');
    expect(warn.mock.calls[0][0]).toContain('"reason":"timeout_outcome_unknown"');
  }, 5_000);

  it("reports scheduler failure without throwing into the business caller", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => logOps("guest", "guest.booking_created", {}, () => {
      throw new Error("scheduler failed secret-value");
    })).not.toThrow();
    expect(warn.mock.calls[0][0]).toContain('"reason":"scheduler_unavailable"');
    expect(warn.mock.calls[0][0]).not.toContain("secret-value");
  });
});
