import { describe, expect, it } from "vitest";
import { RESTORE_VERIFY_QUERIES, restoreEvidenceMeetsA } from "./restore-verify-queries";

describe("restore verify", () => {
  it("lists core table checks", () => {
    const ids = RESTORE_VERIFY_QUERIES.map((q) => q.id);
    expect(ids).toContain("reservations_count");
    expect(ids).toContain("ops_events_table");
    expect(ids).toContain("refund_requests_table");
  });

  it("script_ready and validate_only are not A", () => {
    expect(restoreEvidenceMeetsA("script_ready")).toBe(false);
    expect(restoreEvidenceMeetsA("validate_only")).toBe(false);
    expect(restoreEvidenceMeetsA("isolated_restore_verified")).toBe(true);
  });
});
