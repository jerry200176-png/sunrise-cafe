import { describe, expect, it } from "vitest";
import { reservationMatchesBranch } from "./reminder-branch-match";

const BRANCH = { id: "branch-daan" };

describe("reservationMatchesBranch", () => {
  it("matches nested branch.id (preferred join shape)", () => {
    expect(
      reservationMatchesBranch(
        { room: { branch: { id: "branch-daan", name: "大安店" } } },
        BRANCH
      )
    ).toBe(true);
  });

  it("matches rooms.branch_id when nested branch.id is missing", () => {
    // Regression: send-line used to select only branch.name, so id filters always missed.
    expect(
      reservationMatchesBranch(
        { room: { branch_id: "branch-daan", branch: { name: "大安店" } } },
        BRANCH
      )
    ).toBe(true);
  });

  it("does not match when only branch.name is present (the production bug)", () => {
    expect(
      reservationMatchesBranch({ room: { branch: { name: "大安店" } } }, BRANCH)
    ).toBe(false);
  });

  it("does not match a different branch id", () => {
    expect(
      reservationMatchesBranch(
        { room: { branch_id: "other", branch: { id: "other", name: "別店" } } },
        BRANCH
      )
    ).toBe(false);
  });

  it("matches top-level reservation.branch_id as last resort", () => {
    expect(reservationMatchesBranch({ branch_id: "branch-daan" }, BRANCH)).toBe(true);
  });
});
