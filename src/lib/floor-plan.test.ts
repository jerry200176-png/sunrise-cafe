import { describe, expect, it } from "vitest";
import { DAAN_FLOOR_PLAN, assignRoomsToPlan, floorPlanForBranch, planToScene, type FloorPlan } from "@/lib/floor-plan";

const rooms = [
  { id: "a", name: "A 小包廂", capacity: 4 },
  { id: "b", name: "B 小包廂", capacity: 5 },
  { id: "c", name: "C 小包廂", capacity: 3 },
  { id: "d", name: "D 小包廂", capacity: 3 },
  { id: "m", name: "會議室", capacity: 12 },
];

describe("floor plan geometry (from the drawing's dimensions)", () => {
  it("room widths along the window wall match the drawing", () => {
    expect(DAAN_FLOOR_PLAN.rooms.map((room) => room.rect.w)).toEqual([202, 211, 218, 226, 434]);
  });

  it("room areas match the drawing within 2%", () => {
    const drawn = [5.89, 6.16, 3.9, 4.04, 14.38];
    DAAN_FLOOR_PLAN.rooms.forEach((room, index) => {
      const area = (room.rect.w * room.rect.d) / 10_000;
      expect(Math.abs(area - drawn[index]) / drawn[index]).toBeLessThan(0.02);
    });
  });

  it("rooms do not overlap each other", () => {
    const r = DAAN_FLOOR_PLAN.rooms.map((room) => room.rect);
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
      const overlap = r[i].u < r[j].u + r[j].w && r[j].u < r[i].u + r[i].w && r[i].v < r[j].v + r[j].d && r[j].v < r[i].v + r[i].d;
      expect(overlap).toBe(false);
    }
  });
});

describe("floorPlanForBranch", () => {
  it("matches by branch keyword from the plan config", () => {
    expect(floorPlanForBranch("昇咖啡 大安店")?.id).toBe("daan");
    expect(floorPlanForBranch("昇咖啡 信義店")).toBeNull();
    const custom: FloorPlan = { ...DAAN_FLOOR_PLAN, id: "x", branchKeywords: ["信義"] };
    expect(floorPlanForBranch("昇咖啡 信義店", [custom])?.id).toBe("x");
  });
});

describe("assignRoomsToPlan", () => {
  it("puts the biggest room in the meeting slot and the rest in name order", () => {
    const map = assignRoomsToPlan(DAAN_FLOOR_PLAN, rooms)!;
    expect(map.get("m")?.slot).toBe("room5");
    expect(["a", "b", "c", "d"].map((id) => map.get(id)?.slot)).toEqual(["room1", "room2", "room3", "room4"]);
  });

  it("exact names in the plan config win over automatic order", () => {
    const plan: FloorPlan = {
      ...DAAN_FLOOR_PLAN,
      rooms: DAAN_FLOOR_PLAN.rooms.map((room) => room.slot === "room1" ? { ...room, names: ["D 小包廂"] } : room),
    };
    const map = assignRoomsToPlan(plan, rooms)!;
    expect(map.get("d")?.slot).toBe("room1");
    expect(map.get("a")?.slot).toBe("room2");
  });

  it("refuses to guess when the room count differs from the plan", () => {
    expect(assignRoomsToPlan(DAAN_FLOOR_PLAN, rooms.slice(0, 4))).toBeNull();
  });
});

describe("planToScene (view from the counter)", () => {
  it("puts room 1 on the right and the window at the back", () => {
    const [room1, , , , meeting] = DAAN_FLOOR_PLAN.rooms;
    const a = planToScene(DAAN_FLOOR_PLAN, room1.rect);
    const b = planToScene(DAAN_FLOOR_PLAN, meeting.rect);
    expect(a.x).toBeGreaterThan(b.x);
    const counter = DAAN_FLOOR_PLAN.landmarks.find((l) => l.id === "counter")!;
    expect(planToScene(DAAN_FLOOR_PLAN, counter.rect).z).toBeGreaterThan(a.z);
    expect(a.width).toBeCloseTo(room1.rect.w / 100);
  });
});
