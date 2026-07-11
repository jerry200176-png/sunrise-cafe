import { describe, expect, it } from "vitest";

describe("job-runs module", () => {
  it("exports cron job names used by Vercel schedule", async () => {
    const { fetchCronJobSummaries } = await import("@/lib/job-runs");
    const result = await fetchCronJobSummaries();
    expect(result).toHaveProperty("ready");
    expect(result).toHaveProperty("jobs");
    if (!result.ready) {
      expect(result.jobs).toEqual([]);
    }
  });
});
