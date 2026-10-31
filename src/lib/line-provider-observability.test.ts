import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops-log", () => ({ logOps: vi.fn() }));
import { logOps } from "@/lib/ops-log";
import { observeLineProviderRejection } from "./line-provider-observability";

afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

describe("LINE provider outcome observability", () => {
  it.each([[429, "line.provider_rejected"], [409, "line.provider_unknown"], [503, "line.provider_unknown"]] as const)("records HTTP %s as %s", (status, action) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    observeLineProviderRejection({ channel: "customer", operation: "push", status });
    expect(logOps).toHaveBeenCalledWith("line", action, expect.objectContaining({ provider_status: status }));
  });
});
