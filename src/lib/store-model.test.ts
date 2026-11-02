import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DAAN_FLOOR_PLAN, planToScene } from "./floor-plan";

describe("assembled Daan guest store model", () => {
  it("contains a selectable parent for each room at the existing plan position", () => {
    const bytes = readFileSync("public/models/store/daan.glb");
    expect(bytes.toString("ascii", 0, 4)).toBe("glTF");
    const jsonLength = bytes.readUInt32LE(12);
    const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as { nodes: { name?: string; translation?: number[]; children?: number[] }[] };
    for (const slot of DAAN_FLOOR_PLAN.rooms) {
      const nodes = gltf.nodes.filter((node) => node.name === `Room_${slot.slot}`);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].children?.length).toBeGreaterThan(0);
      const position = planToScene(DAAN_FLOOR_PLAN, slot.rect);
      expect(nodes[0].translation?.[0]).toBeCloseTo(position.x, 3);
      expect(nodes[0].translation?.[2]).toBeCloseTo(position.z, 3);
    }
  });
});
