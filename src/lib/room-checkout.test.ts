import { describe, expect, it } from "vitest";
import { getDepositAmount } from "@/lib/booking-utils";
import { SLOT_STEP_MS } from "@/lib/slot-grid";
import {
  EXTEND_STEPS_MINUTES,
  addMinutes,
  computeCheckoutBill,
  newEndProblem,
  nextBlockingStart,
  overtimeSettledEnd,
  resolveClockNear,
  roomFloorState,
  type FloorReservation,
} from "@/lib/room-checkout";

// 2026-10-14 is a Wednesday (weekday); 2026-10-17 is a Saturday.
const at = (hhmm: string, day = "2026-10-14") => new Date(`${day}T${hhmm}:00+08:00`).toISOString();

function res(partial: Partial<FloorReservation>): FloorReservation {
  return {
    id: "r1", room_id: "room-a", customer_name: "王小明", booking_code: "AB12",
    start_time: at("14:00"), end_time: at("16:00"), status: "confirmed",
    guest_count: 3, total_price: 400, is_deposit_paid: false, ...partial,
  };
}

describe("roomFloorState", () => {
  it("is idle with no reservations", () => {
    expect(roomFloorState([], Date.parse(at("12:00"))).status).toBe("idle");
  });

  it("flags upcoming within the window and follows the configured window", () => {
    const list = [res({ start_time: at("14:00") })];
    expect(roomFloorState(list, Date.parse(at("13:30"))).status).toBe("upcoming");
    expect(roomFloorState(list, Date.parse(at("13:30")), { upcomingMinutes: 20 }).status).toBe("idle");
    expect(roomFloorState(list, Date.parse(at("13:30")), { upcomingMinutes: 45 }).status).toBe("upcoming");
  });

  it("shows awaiting when the slot started but guest not checked in", () => {
    const state = roomFloorState([res({})], Date.parse(at("14:10")));
    expect(state.status).toBe("awaiting");
    expect(state.current?.id).toBe("r1");
  });

  it("checked-in guest: in_use → ending_soon (configurable) → overtime", () => {
    const list = [res({ status: "checked_in" })];
    expect(roomFloorState(list, Date.parse(at("15:00"))).status).toBe("in_use");
    expect(roomFloorState(list, Date.parse(at("15:50"))).status).toBe("ending_soon");
    expect(roomFloorState(list, Date.parse(at("15:30")), { endingSoonMinutes: 40 }).status).toBe("ending_soon");
    const over = roomFloorState(list, Date.parse(at("16:20")));
    expect(over.status).toBe("overtime");
    expect(over.minutesLeft).toBe(-20);
  });

  it("reports the next group separately from the current one", () => {
    const list = [res({ status: "checked_in" }), res({ id: "r2", start_time: at("16:00"), end_time: at("18:00") })];
    const state = roomFloorState(list, Date.parse(at("15:00")));
    expect(state.current?.id).toBe("r1");
    expect(state.next?.id).toBe("r2");
  });
});

describe("computeCheckoutBill", () => {
  it("with extension records, bills the booked total plus the recorded fees (rate changes don't matter)", () => {
    const input = { startTime: at("14:00"), endTime: at("17:00"), bookedTotal: 400, isDepositPaid: true, foodTotal: 120,
      extensions: { minutes: 60, fee: 230 } };
    const a = computeCheckoutBill({ ...input, room: { price_weekday: 200, price_weekend: 300 } });
    const b = computeCheckoutBill({ ...input, room: { price_weekday: 999, price_weekend: 999 } });
    expect(a).toMatchObject({ bookedRoomFee: 400, extensionFee: 230, roomFee: 630, due: 630 + 120 - getDepositAmount(400) });
    expect(b.roomFee).toBe(a.roomFee);
  });

  it("an early leave lowers the room fee and can turn into a refund", () => {
    const bill = computeCheckoutBill({ room: { price_weekday: 300, price_weekend: 300 }, startTime: at("14:00"), endTime: at("14:30"),
      bookedTotal: 600, isDepositPaid: true, foodTotal: 0, extensions: { minutes: -90, fee: -450 } });
    expect(bill).toMatchObject({ roomFee: 150, due: 0, refund: getDepositAmount(600) - 150 });
  });

  it("without a booked total, prices only the originally booked minutes at the current rate", () => {
    const bill = computeCheckoutBill({ room: { price_weekday: 200, price_weekend: 200 }, startTime: at("14:00"), endTime: at("17:00"),
      bookedTotal: null, isDepositPaid: false, foodTotal: 0, extensions: { minutes: 60, fee: 150 } });
    expect(bill).toMatchObject({ bookedRoomFee: 400, roomFee: 550 });
  });

  it("bills the room from the current times and follows the room rates", () => {
    const base = { startTime: at("14:00"), endTime: at("17:00"), bookedTotal: null, isDepositPaid: false, foodTotal: 360 };
    const a = computeCheckoutBill({ ...base, room: { price_weekday: 200, price_weekend: 300 } });
    expect(a).toMatchObject({ hours: 3, hourlyRate: 200, isWeekend: false, roomFee: 600, foodTotal: 360, due: 960 });
    const b = computeCheckoutBill({ ...base, room: { price_weekday: 250, price_weekend: 300 } });
    expect(b.roomFee).toBe(750);
  });

  it("uses the weekend rate on weekends", () => {
    const bill = computeCheckoutBill({
      room: { price_weekday: 200, price_weekend: 340 }, startTime: at("14:00", "2026-10-17"), endTime: at("16:00", "2026-10-17"),
      bookedTotal: null, isDepositPaid: false, foodTotal: 0,
    });
    expect(bill).toMatchObject({ isWeekend: true, hourlyRate: 340, roomFee: 680 });
  });

  it("credits the deposit from the booked total, not the extended fee", () => {
    const bill = computeCheckoutBill({
      room: { price_weekday: 200, price_weekend: 300 }, startTime: at("14:00"), endTime: at("17:30"),
      bookedTotal: 400, isDepositPaid: true, foodTotal: 120,
    });
    expect(bill.roomFee).toBe(700);
    expect(bill.depositCredit).toBe(getDepositAmount(400));
    expect(bill.due).toBe(700 + 120 - getDepositAmount(400));
  });

  it("never goes negative and ignores deposit when unpaid", () => {
    const bill = computeCheckoutBill({
      room: { price_weekday: 0, price_weekend: 0 }, startTime: at("14:00"), endTime: at("15:00"),
      bookedTotal: 5000, isDepositPaid: true, foodTotal: 0,
    });
    expect(bill.due).toBe(0);
    expect(computeCheckoutBill({ room: { price_weekday: 100, price_weekend: 100 }, startTime: at("14:00"), endTime: at("15:00"),
      bookedTotal: 100, isDepositPaid: false, foodTotal: 0 }).depositCredit).toBe(0);
  });
});

describe("extension", () => {
  it("quick steps follow the booking slot grid", () => {
    expect(EXTEND_STEPS_MINUTES).toEqual([SLOT_STEP_MS / 60_000, (2 * SLOT_STEP_MS) / 60_000]);
  });

  it("finds the next blocking start in the same room, ignoring cancelled and other rooms", () => {
    const current = res({ status: "checked_in" });
    const others = [
      res({ id: "x", room_id: "room-b", start_time: at("16:00") }),
      res({ id: "c", status: "cancelled", start_time: at("16:00") }),
      res({ id: "n2", start_time: at("19:00") }),
      res({ id: "n1", start_time: at("17:00") }),
    ];
    expect(nextBlockingStart(current, others)).toBe(at("17:00"));
    expect(nextBlockingStart(current, [])).toBeNull();
  });

  it("treats the released statuses it is given as free slots (no_show after #444)", () => {
    const current = res({ status: "checked_in" });
    const others = [res({ id: "ns", status: "no_show", start_time: at("16:30") }), res({ id: "n1", start_time: at("18:00") })];
    expect(nextBlockingStart(current, others)).toBe(at("16:30"));
    expect(nextBlockingStart(current, others, ["cancelled", "no_show"])).toBe(at("18:00"));
  });

  it("validates a new end time", () => {
    const start = at("14:00");
    expect(newEndProblem(start, addMinutes(at("16:00"), 30), at("17:00"))).toBeNull();
    expect(newEndProblem(start, at("17:00"), at("17:00"))).toBeNull();
    expect(newEndProblem(start, at("17:30"), at("17:00"))).toMatch(/下一組客人（17:00/);
    expect(newEndProblem(start, at("13:00"), null)).toMatch(/比開始時間晚/);
    expect(newEndProblem(start, "nope", null)).toMatch(/沒填好/);
    expect(newEndProblem(start, at("15:30"), null)).toBeNull(); // 提早結束
  });
});

describe("overtimeSettledEnd", () => {
  it("rounds overtime up to the billing step and follows the configured step", () => {
    expect(overtimeSettledEnd(at("16:00"), Date.parse(at("15:59")))).toBeNull();
    expect(overtimeSettledEnd(at("16:00"), Date.parse(at("16:01")))).toBe(addMinutes(at("16:00"), SLOT_STEP_MS / 60_000));
    expect(overtimeSettledEnd(at("16:00"), Date.parse(at("16:31")))).toBe(addMinutes(at("16:00"), (2 * SLOT_STEP_MS) / 60_000));
    expect(overtimeSettledEnd(at("16:00"), Date.parse(at("16:01")), 15)).toBe(at("16:15"));
    expect(overtimeSettledEnd(at("16:00"), Date.parse(at("16:01")), 60)).toBe(at("17:00"));
  });
});

describe("resolveClockNear", () => {
  it("picks the day closest to the current end, across midnight", () => {
    expect(resolveClockNear("16:30", at("16:00"))).toBe(at("16:30"));
    expect(resolveClockNear("00:30", at("23:30"))).toBe(at("00:30", "2026-10-15"));
    expect(resolveClockNear("23:30", at("00:30", "2026-10-15"))).toBe(at("23:30"));
    expect(resolveClockNear("9:3", at("16:00"))).toBeNull();
  });
});

describe("computeCheckoutBill — food already settled", () => {
  it("shows the food total but does not charge it again", () => {
    const base = { room: { price_weekday: 200, price_weekend: 300 }, startTime: at("14:00"), endTime: at("16:00"),
      bookedTotal: null, isDepositPaid: false, foodTotal: 360 };
    expect(computeCheckoutBill(base).due).toBe(760);
    const settled = computeCheckoutBill({ ...base, foodSettled: true });
    expect(settled).toMatchObject({ foodTotal: 360, foodSettled: true, due: 400 });
  });
});

describe("review fixes", () => {
  it("uses the Taipei calendar day for the weekend rate (UTC date differs before 08:00)", () => {
    // Saturday 2026-10-17 07:00 Taipei = Friday 23:00 UTC
    const start = new Date("2026-10-17T07:00:00+08:00").toISOString();
    expect(start.slice(0, 10)).toBe("2026-10-16");
    const bill = computeCheckoutBill({ room: { price_weekday: 200, price_weekend: 300 }, startTime: start,
      endTime: addMinutes(start, 120), bookedTotal: null, isDepositPaid: false, foodTotal: 0 });
    expect(bill).toMatchObject({ isWeekend: true, roomFee: 600 });
  });

  it("keeps the next group visible when it has already started during an overtime", () => {
    const list = [res({ status: "checked_in", end_time: at("16:00") }), res({ id: "r2", start_time: at("16:00"), end_time: at("18:00") })];
    const state = roomFloorState(list, Date.parse(at("16:20")));
    expect(state.status).toBe("overtime");
    expect(state.next?.id).toBe("r2");
  });
});

describe("two checked-in groups in one room", () => {
  it("treats the latest checked-in group as current", () => {
    const list = [res({ status: "checked_in", end_time: at("16:00") }), res({ id: "r2", status: "checked_in", start_time: at("16:00"), end_time: at("18:00") })];
    expect(roomFloorState(list, Date.parse(at("16:30"))).current?.id).toBe("r2");
  });

  it("reports the deposit surplus as a refund instead of hiding it when the stay is shortened", () => {
    const bill = computeCheckoutBill({ room: { price_weekday: 200, price_weekend: 300 },
      startTime: "2026-10-14T06:00:00.000Z", endTime: "2026-10-14T06:30:00.000Z",
      bookedTotal: 400, isDepositPaid: true, foodTotal: 0 });
    expect(bill.due).toBe(0);
    expect(bill.refund).toBe(bill.depositCredit - bill.roomFee);
    expect(bill.refund).toBeGreaterThan(0);
  });
});

describe("overdue waiting reservations", () => {
  it("keeps a group that never arrived as the room's current attention item after its end time", () => {
    const state = roomFloorState([res({ status: "confirmed" })], Date.parse(at("17:30")));
    expect(state.status).toBe("awaiting");
    expect(state.current?.status).toBe("confirmed");
  });
});
