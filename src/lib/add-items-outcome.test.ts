import { describe, expect, it } from "vitest";
import { readAddItemsOutcome } from "./add-items-outcome";

describe("add-items response contract", () => {
  it.each([
    { ok: true, order: { id: "o" }, billing: { end_time: "time" } },
    { ok: true, committed: true, refresh_failed: true },
  ])("accepts only documented successful responses", async (body) => {
    expect((await readAddItemsOutcome(Response.json(body))).kind).toBe("committed");
  });

  it.each([{}, { ok: true }, { ok: true, committed: true }, { ok: true, order: {}, billing: {} }, { ok: true, refresh_failed: true, order: {}, billing: {} }, null])
  ("treats incomplete success as unknown", async (body) => {
    expect((await readAddItemsOutcome(Response.json(body))).kind).toBe("unknown");
  });

  it("recognizes only explicitly marked client rejections", async () => {
    expect((await readAddItemsOutcome(Response.json({ error: "缺少餐點", add_outcome: "not_attempted" }, { status: 400 }))).kind).toBe("not_attempted");
    expect((await readAddItemsOutcome(Response.json({ error: "失敗" }, { status: 409 }))).kind).toBe("unknown");
    expect((await readAddItemsOutcome(Response.json({ error: "失敗", add_outcome: "not_attempted" }, { status: 500 }))).kind).toBe("unknown");
    expect((await readAddItemsOutcome(new Response("not json", { status: 502 }))).kind).toBe("unknown");
  });
});
