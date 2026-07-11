import { describe, expect, it } from "vitest";
import {
  assertReservationPatchAllowed,
  assertReservationCancelAllowed,
  assertReservationReadAllowed,
} from "./reservation-access";
import type { AdminContext } from "./rbac";

const staff: AdminContext = {
  user_id: "s1",
  role: "staff",
  branch_ids: ["b1"],
  legacy: false,
};

const manager: AdminContext = {
  user_id: "m1",
  role: "branch_manager",
  branch_ids: ["b1"],
  legacy: false,
};

const finance: AdminContext = {
  user_id: "f1",
  role: "finance",
  branch_ids: ["b1"],
  legacy: false,
};

describe("reservation-access", () => {
  it("staff can patch status only", () => {
    expect(assertReservationPatchAllowed(staff, { status: "confirmed" }, "b1")).toBeNull();
    expect(assertReservationPatchAllowed(staff, { notes: "x" }, "b1")).toBe("Forbidden");
  });

  it("staff cannot cancel via status or delete permission", () => {
    expect(assertReservationPatchAllowed(staff, { status: "cancelled" }, "b1")).toBe(
      "Forbidden"
    );
    expect(assertReservationCancelAllowed(staff, "b1")).toBe("Forbidden");
  });

  it("branch_manager can write on assigned branch", () => {
    expect(assertReservationPatchAllowed(manager, { total_price: 1000 }, "b1")).toBeNull();
    expect(assertReservationPatchAllowed(manager, { status: "cancelled" }, "b1")).toBeNull();
    expect(assertReservationPatchAllowed(manager, { notes: "ok" }, "b2")).toBe("Forbidden");
  });

  it("finance can patch deposit fields only", () => {
    expect(
      assertReservationPatchAllowed(finance, { is_deposit_paid: true }, "b1")
    ).toBeNull();
    expect(assertReservationPatchAllowed(finance, { customer_name: "x" }, "b1")).toBe(
      "Forbidden"
    );
  });

  it("read requires reservations:read on branch", () => {
    expect(assertReservationReadAllowed(finance, "b1")).toBe("Forbidden");
    expect(assertReservationReadAllowed(staff, "b1")).toBeNull();
    expect(assertReservationReadAllowed(staff, "b2")).toBe("Forbidden");
  });
});
