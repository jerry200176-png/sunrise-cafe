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
});
