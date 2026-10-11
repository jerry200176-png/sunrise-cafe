import { describe, expect, it } from "vitest";
import { applyDecisions, buildAdvice, type BranchMetrics, type Decision } from "@/lib/business-advice";

const hours = (m: Record<number, number>) => Array.from({ length: 24 }, (_, h) => m[h] ?? 0);
const base = (over: Partial<BranchMetrics> = {}): BranchMetrics => ({
  branchId: "b1", branchName: "A店", bookings: 40, cancelled: 2, cancelledUnpaid: 0, noShows: 0, depositPaid: 36, avgPrice: 1000,
  hourBookings: hours({ 12: 10, 14: 10, 18: 10, 19: 10 }), rooms: [{ id: "r1", name: "包廂1", bookings: 20 }, { id: "r2", name: "包廂2", bookings: 20 }],
  uniqueGuests: 30, repeatGuests: 12, preorderBookings: 20, ...over,
});
const ids = (r: ReturnType<typeof buildAdvice>) => (r.enough ? [...r.top, ...r.more].map((s) => s.id) : []);

describe("buildAdvice", () => {
  it.each([
    ["under 4 weeks", { weeksCovered: 2, branches: [base()] }, 2],
    ["under 20 bookings", { weeksCovered: 5, branches: [base({ bookings: 10 })] }, 5],
  ])("not enough data: %s", (_n, input, wait) => {
    const r = buildAdvice(input);
    expect(r.enough).toBe(false);
    if (!r.enough) expect(r.weeksToWait).toBe(wait);
  });

  it("healthy branch: no suggestions", () => {
    const r = buildAdvice({ weeksCovered: 4, branches: [base()] });
    expect(r).toEqual({ enough: true, top: [], more: [] });
  });

  it.each([
    ["no-show", { noShows: 4 }, "no-show:b1"],
    ["unpaid cancel", { cancelledUnpaid: 8, cancelled: 8 }, "unpaid-cancel:b1"],
    ["deposit rate", { depositPaid: 20 }, "deposit-rate:b1"],
    ["off peak", { hourBookings: hours({ 12: 12, 15: 2, 18: 10 }) }, "off-peak:b1"],
    ["preorder", { preorderBookings: 2 }, "preorder:b1"],
    ["room imbalance", { rooms: [{ id: "r1", name: "大包廂", bookings: 32 }, { id: "r2", name: "小包廂", bookings: 3 }] }, "room-imbalance:b1"],
    ["repeat", { repeatGuests: 1 }, "repeat:b1"],
  ])("fires %s", (_n, over, id) => {
    expect(ids(buildAdvice({ weeksCovered: 4, branches: [base(over)] }))).toContain(id);
  });

  it("ranks by NT$ impact, top 3 then more, each with numbers and a link", () => {
    const r = buildAdvice({ weeksCovered: 6, branches: [base({ noShows: 8, cancelledUnpaid: 6, depositPaid: 20, preorderBookings: 2, repeatGuests: 1 })] });
    if (!r.enough) throw new Error("expected enough");
    expect(r.top).toHaveLength(3);
    const all = [...r.top, ...r.more];
    expect(all.map((s) => s.impactNt)).toEqual([...all.map((s) => s.impactNt)].sort((a, b) => b - a));
    expect(r.more.length).toBeGreaterThan(0);
    for (const s of all) {
      expect(s.numbers.length).toBeGreaterThan(0);
      expect(s.href).toMatch(/^\/admin\//);
    }
  });

  it("branch comparison only with 2+ branches and a real gap", () => {
    const a = base();
    const small = base({ branchId: "b2", branchName: "B店", bookings: 20, depositPaid: 18, preorderBookings: 10, uniqueGuests: 15, repeatGuests: 6, hourBookings: hours({ 12: 5, 18: 5 }), rooms: [] });
    expect(ids(buildAdvice({ weeksCovered: 4, branches: [a, small] }))).toContain("branch-gap:b2");
    expect(ids(buildAdvice({ weeksCovered: 4, branches: [a] })).some((i) => i.startsWith("branch-gap"))).toBe(false);
  });
});

describe("applyDecisions", () => {
  const advice = () => buildAdvice({ weeksCovered: 6, branches: [base({ noShows: 8, cancelledUnpaid: 8, cancelled: 8, depositPaid: 20, preorderBookings: 2, repeatGuests: 1 })] });
  const dec = (id: string, decision: Decision["decision"], decidedAt: string): Decision => ({
    suggestionId: id, decision, decidedAt, snapshot: { title: "t", numbers: [{ label: "沒來", value: "8 筆" }], impactNt: 1 },
  });
  const now = new Date("2026-11-20T00:00:00Z");

  it("skipped disappears and the next one moves up; adopted moves to its own list", () => {
    const first = advice();
    if (!first.enough) throw new Error();
    const [a, b] = first.top;
    const r = applyDecisions(first, [dec(a.id, "skipped", "2026-11-19T00:00:00Z"), dec(b.id, "adopted", "2026-11-19T00:00:00Z")], now);
    if (!r.enough) throw new Error();
    expect([...r.top, ...r.more].map((s) => s.id)).not.toContain(a.id);
    expect([...r.top, ...r.more].map((s) => s.id)).not.toContain(b.id);
    expect(r.top).toHaveLength(3);
    expect(r.adopted).toEqual([expect.objectContaining({ suggestionId: b.id, after: null, daysLeft: 27 })]);
  });

  it("after 4 weeks an adopted suggestion shows before/after; gone = resolved", () => {
    const healthy = buildAdvice({ weeksCovered: 8, branches: [base()] });
    const r = applyDecisions(healthy, [dec("no-show:b1", "adopted", "2026-10-01T00:00:00Z")], now);
    if (!r.enough) throw new Error();
    expect(r.adopted?.[0]).toMatchObject({ daysLeft: 0, after: { resolved: true, numbers: [] }, before: [{ label: "沒來", value: "8 筆" }] });
    const still = applyDecisions(advice(), [dec("no-show:b1", "adopted", "2026-10-01T00:00:00Z")], now);
    if (!still.enough) throw new Error();
    expect(still.adopted?.[0].after).toMatchObject({ resolved: false });
    expect(still.adopted?.[0].after?.numbers[0].label).toBe("沒來");
  });
});
