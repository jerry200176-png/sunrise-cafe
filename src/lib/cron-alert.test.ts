import { describe, expect, it } from "vitest";
import { formatCronAlert } from "./cron-alert";

describe("cron-alert", () => {
  it("formats job name and error message", () => {
    const text = formatCronAlert("deposit-deadline", new Error("DB timeout"));
    expect(text).toContain("deposit-deadline");
    expect(text).toContain("DB timeout");
    expect(text).toContain("Cron 失敗");
  });

  it("truncates long errors", () => {
    const long = "x".repeat(500);
    const text = formatCronAlert("send-line", long);
    expect(text.length).toBeLessThan(600);
    expect(text).toContain("…");
  });
});
