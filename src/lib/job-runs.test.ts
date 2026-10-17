import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  isAdminConfigured: vi.fn(() => false),
  createClient: vi.fn(() => { throw new Error("Unexpected database client in unconfigured cron fixture"); }),
  fetch: vi.fn(() => { throw new Error("Unexpected network access in cron fixture"); }),
}));

vi.mock("@/lib/supabase-admin", () => ({ isAdminConfigured: fixture.isAdminConfigured }));
vi.mock("@supabase/supabase-js", () => ({ createClient: fixture.createClient }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fixture.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  expect(fixture.createClient).not.toHaveBeenCalled();
  expect(fixture.fetch).not.toHaveBeenCalled();
});

describe("job-runs module", () => {
  it("returns unavailable summaries without database access when admin is not configured", async () => {
    const { fetchCronJobSummaries } = await import("@/lib/job-runs");
    const result = await fetchCronJobSummaries();
    expect(result).toEqual({ ready: false, jobs: [] });
    expect(fixture.isAdminConfigured).toHaveBeenCalledTimes(1);
  });
});
