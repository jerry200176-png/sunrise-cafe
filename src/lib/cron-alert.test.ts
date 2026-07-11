import { describe, expect, it } from "vitest";
import { formatCronAlert, errorToDetail } from "./cron-alert";

describe("cron-alert", () => {
  it("formats job name and Error message", () => {
    const text = formatCronAlert("deposit-deadline", new Error("DB timeout"));
    expect(text).toContain("deposit-deadline");
    expect(text).toContain("DB timeout");
    expect(text).toContain("Cron 失敗");
  });

  it("formats PostgREST-style plain objects (not [object Object])", () => {
    const pgError = {
      message: "column reservations.is_reminded_7d does not exist",
      code: "42703",
      details: null,
      hint: null,
    };
    expect(errorToDetail(pgError)).toContain("is_reminded_7d");
    expect(errorToDetail(pgError)).toContain("42703");
    const text = formatCronAlert("send-line-7d", pgError);
    expect(text).not.toContain("[object Object]");
    expect(text).toContain("send-line-7d");
  });

  it("truncates long errors", () => {
    const long = "x".repeat(500);
    const text = formatCronAlert("send-line", long);
    expect(text.length).toBeLessThan(600);
    expect(text).toContain("…");
  });
});
