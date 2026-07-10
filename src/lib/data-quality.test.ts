import { describe, expect, it } from "vitest";
import {
  checkCancelledWithoutMetadata,
  checkInvalidTimeRange,
  detectCancellationAnomaly,
  isValidTaiwanPhone,
  runReservationChecks,
} from "./data-quality";

describe("data-quality", () => {
  it("validates Taiwan phone", () => {
    expect(isValidTaiwanPhone("0912345678")).toBe(true);
    expect(isValidTaiwanPhone("123")).toBe(false);
  });

  it("detects invalid time range", () => {
    const issue = checkInvalidTimeRange([
      {
        id: "1",
        room_id: "r1",
        phone: "0912345678",
        start_time: "2026-08-15T12:00:00+08:00",
        end_time: "2026-08-15T10:00:00+08:00",
        status: "confirmed",
      },
    ]);
    expect(issue?.code).toBe("invalid_time_range");
  });

  it("flags cancelled without metadata", () => {
    const issue = checkCancelledWithoutMetadata([
      {
        id: "1",
        room_id: "r1",
        phone: "0912345678",
        start_time: "2026-08-15T10:00:00+08:00",
        end_time: "2026-08-15T12:00:00+08:00",
        status: "cancelled",
      },
    ]);
    expect(issue?.code).toBe("cancelled_missing_metadata");
  });

  it("detects cancellation spike", () => {
    const issue = detectCancellationAnomaly(10, 2);
    expect(issue?.code).toBe("cancellation_spike");
  });

  it("runReservationChecks returns multiple issues", () => {
    const issues = runReservationChecks(
      [
        {
          id: "1",
          room_id: "missing",
          phone: "bad",
          start_time: "2026-08-15T10:00:00+08:00",
          end_time: "2026-08-15T12:00:00+08:00",
          status: "cancelled",
        },
      ],
      new Set(["r1"])
    );
    expect(issues.length).toBeGreaterThan(1);
  });
});
