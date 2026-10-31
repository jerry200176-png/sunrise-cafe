import { describe, expect, it, vi } from "vitest";
import { BOOKABLE_HTTP, checkBookable, resolveDay, type BookableDeps, type BranchSchedule } from "./bookable";

// In-memory adapter at the checkBookable seam.
function world(opts: {
  branch?: BranchSchedule;
  globalClosed?: string[];
  booked?: { id: string; start: string; end: string }[];
} = {}): BookableDeps {
  const branch: BranchSchedule = opts.branch ?? { open_time: "10:00", close_time: "22:00" };
  return {
    roomBranchId: async () => "b1",
    branch: async () => branch,
    globalClosedDates: async () => opts.globalClosed ?? [],
    hasConflict: async (_r, s, e, x) =>
      (opts.booked ?? []).some((b) => b.id !== x && b.start < e && b.end > s),
  };
}

const NOW = new Date("2099-10-01T00:00:00+08:00").getTime();
// 2099-10-06 is a Tuesday. Times in Taipei.
const at = (h: string, date = "2099-10-06") => `${date}T${h}:00+08:00`;

const cases: [string, string, string, Parameters<typeof world>[0], "guest" | "admin", string][] = [
  ["2h inside hours", at("10:00"), at("12:00"), {}, "guest", "ok"],
  ["exactly 8h to close", at("14:00"), at("22:00"), {}, "guest", "ok"],
  ["end before start", at("12:00"), at("10:00"), {}, "guest", "invalid_time"],
  ["garbage", "nope", at("10:00"), {}, "admin", "invalid_time"],
  ["1.5h", at("10:00"), at("11:30"), {}, "guest", "too_short"],
  ["1h recurring-style (admin)", at("10:00"), at("11:00"), {}, "admin", "too_short"],
  ["9h", at("10:00"), at("19:00"), {}, "admin", "too_long"],
  ["starts before opening", at("08:00"), at("10:00"), {}, "guest", "outside_hours"],
  ["ends after closing", at("20:00"), at("23:00"), {}, "guest", "outside_hours"],
  ["admin may book outside hours", at("08:00"), at("10:00"), {}, "admin", "ok"],
  ["global closed date", at("10:00"), at("12:00"), { globalClosed: ["2099-10-06"] }, "guest", "closed_date"],
  ["branch closed date", at("10:00"), at("12:00"), { branch: { open_time: "10:00", close_time: "22:00", closed_dates: ["2099-10-06"] } }, "guest", "closed_date"],
  ["closed weekday", at("10:00"), at("12:00"), { branch: { weekly_hours: { tue: null }, open_time: "10:00", close_time: "22:00" } }, "guest", "closed_date"],
  ["weekday hours override", at("10:00"), at("12:00"), { branch: { weekly_hours: { tue: { open: "14:00", close: "18:00" } } } }, "guest", "outside_hours"],
  ["admin may book a closed date", at("10:00"), at("12:00"), { globalClosed: ["2099-10-06"] }, "admin", "ok"],
  ["overlap", at("11:00"), at("13:00"), { booked: [{ id: "x", start: at("10:00"), end: at("12:00") }] }, "guest", "conflict"],
  ["back-to-back is fine", at("12:00"), at("14:00"), { booked: [{ id: "x", start: at("10:00"), end: at("12:00") }] }, "guest", "ok"],
  ["conflict also binds admin", at("11:00"), at("13:00"), { booked: [{ id: "x", start: at("10:00"), end: at("12:00") }] }, "admin", "conflict"],
];

describe("checkBookable", () => {
  it.each(cases)("%s", async (_n, start, end, w, actor, expected) => {
    const r = await checkBookable("room", start, end, { actor, deps: world(w), nowMs: NOW });
    expect(r.ok ? "ok" : r.reason).toBe(expected);
  });

  it("excludeId ignores the reservation being rescheduled", async () => {
    const deps = world({ booked: [{ id: "me", start: at("10:00"), end: at("12:00") }] });
    const r = await checkBookable("room", at("11:00"), at("13:00"), { actor: "guest", excludeId: "me", deps, nowMs: NOW });
    expect(r.ok).toBe(true);
  });

  it("checkConflict:false leaves conflict detection to the atomic RPC", async () => {
    const deps = world({ booked: [{ id: "x", start: at("10:00"), end: at("12:00") }] });
    const r = await checkBookable("room", at("10:00"), at("12:00"), { actor: "guest", checkConflict: false, deps, nowMs: NOW });
    expect(r.ok).toBe(true);
  });

  it("guest checkConflict:false still fails closed when the room has no branch", async () => {
    const deps = world();
    const roomBranchId = vi.fn(async () => null);
    const branch = vi.fn(deps.branch);
    const globalClosedDates = vi.fn(deps.globalClosedDates);
    const hasConflict = vi.fn(deps.hasConflict);
    const r = await checkBookable("room", at("10:00"), at("12:00"), {
      actor: "guest", checkConflict: false,
      deps: { ...deps, roomBranchId, branch, globalClosedDates, hasConflict }, nowMs: NOW,
    });

    expect(r).toEqual({ ok: false, reason: "branch_not_found" });
    expect(branch).not.toHaveBeenCalled();
    expect(globalClosedDates).not.toHaveBeenCalled();
    expect(hasConflict).not.toHaveBeenCalled();
  });

  it("guest checkConflict:false rejects a missing branch before the atomic RPC", async () => {
    const deps = world();
    const branch = vi.fn(async () => null);
    const hasConflict = vi.fn(deps.hasConflict);
    const r = await checkBookable("room", at("10:00"), at("12:00"), {
      actor: "guest", checkConflict: false,
      deps: { ...deps, branch, hasConflict }, nowMs: NOW,
    });

    expect(r).toEqual({ ok: false, reason: "branch_not_found" });
    expect(hasConflict).not.toHaveBeenCalled();
  });

  it("guest checkConflict:false rejects an archived branch", async () => {
    const deps = world({ branch: { open_time: "10:00", close_time: "22:00", archived_at: "2099-10-01T00:00:00Z" } });
    const globalClosedDates = vi.fn(deps.globalClosedDates);
    const hasConflict = vi.fn(deps.hasConflict);
    const r = await checkBookable("room", at("10:00"), at("12:00"), {
      actor: "guest", checkConflict: false,
      deps: { ...deps, globalClosedDates, hasConflict }, nowMs: NOW,
    });

    expect(r).toEqual({ ok: false, reason: "branch_archived" });
    expect(globalClosedDates).toHaveBeenCalledOnce();
    expect(hasConflict).not.toHaveBeenCalled();
  });

  it("maps unavailable branch reasons to clear guest responses", () => {
    expect(BOOKABLE_HTTP.branch_not_found).toEqual({
      status: 404,
      error: "分店或包廂不存在，請重新選擇",
    });
    expect(BOOKABLE_HTTP.branch_archived).toEqual({
      status: 410,
      error: "該分店已停止接受線上預約",
    });
  });

  it("admin booking remains available for an archived branch", async () => {
    const deps = world({ branch: { open_time: "10:00", close_time: "22:00", archived_at: "2099-10-01T00:00:00Z" } });
    const roomBranchId = vi.fn(deps.roomBranchId);
    const branch = vi.fn(deps.branch);
    const r = await checkBookable("room", at("10:00"), at("12:00"), {
      actor: "admin", deps: { ...deps, roomBranchId, branch }, nowMs: NOW,
    });

    expect(r).toEqual({ ok: true });
    expect(roomBranchId).not.toHaveBeenCalled();
    expect(branch).not.toHaveBeenCalled();
  });

  it("guests cannot book a slot that has already ended", async () => {
    const r = await checkBookable("room", at("10:00"), at("12:00"), { actor: "guest", deps: world(), nowMs: new Date(at("13:00")).getTime() });
    expect(r).toEqual({ ok: false, reason: "in_past" });
  });
});

describe("resolveDay (shared with the availability grid)", () => {
  it("falls back to branch-wide hours and wraps past midnight", () => {
    const d = resolveDay({ open_time: "18:00", close_time: "02:00" }, [], "2099-10-06");
    expect(d).toMatchObject({ closed: false, startIso: "2099-10-06T10:00:00.000Z", endIso: "2099-10-06T18:00:00.000Z" });
  });
});
