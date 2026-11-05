import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { readOptionPreview, renderOptionPreview } from "../../scripts/lib/option-preview-reader";
import { planOptionSetMerge } from "./option-set-merge";

const option = (id: string, set_id: string | null = null) => ({
  id, set_id, item_id: `item-${id}`, option_group: "甜度", option_name: "全糖",
  price_delta: 0, display_order: 0, item: { name: `餐點 ${id}`, branch_id: "branch-1" },
});

function fakeDb(config: { fail?: string; unordered?: boolean; missingItem?: boolean } = {}) {
  const requests: URL[] = [];
  const options = [option("01"), option("02", "already-bound"), option("03"), option("04"), option("05")];
  if (config.missingItem) options[0].item = null as never;
  const branches = [{ id: "branch-1", name: "大安" }, { id: "branch-2", name: "其他" }, { id: "branch-3", name: "第三" }];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    requests.push(url);
    if (init?.method && init.method !== "GET") throw new Error("Unexpected write");
    const table = url.pathname.split("/").pop()!;
    if (config.fail === table) return new Response(JSON.stringify({ message: "synthetic failure" }), { status: 400 });
    let rows: Array<{ id: string }> = table === "menu_item_options" ? options.filter((r) => r.set_id === null) : branches;
    if (table === "menu_item_options" && url.searchParams.get("set_id") !== "is.null") throw new Error("Missing set filter");
    const after = url.searchParams.get("id")?.replace(/^gt\./, "");
    rows = rows.filter((r) => !after || r.id > after).slice(0, 2);
    if (config.unordered && rows.length > 1) rows = [...rows].reverse();
    return new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { db: createClient("http://127.0.0.1:1", "placeholder", { global: { fetch: fetcher } }), requests };
}

describe("option preview reads", () => {
  it("continues after short pages until empty, excludes bound options and pages branches", async () => {
    const { db, requests } = fakeDb();
    const result = await readOptionPreview(db);
    expect(result.rows.map((row) => row.item_id)).toEqual(["item-01", "item-03", "item-04", "item-05"]);
    expect(Object.keys(result.names)).toHaveLength(3);
    expect(requests.filter((url) => url.pathname.endsWith("/menu_item_options"))).toHaveLength(3);
    expect(requests.filter((url) => url.pathname.endsWith("/branches"))).toHaveLength(3);
    for (const url of requests) expect(url.searchParams.get("order")).toBe("id.asc");
  });

  it("fails the whole preview on a query failure", async () => {
    await expect(readOptionPreview(fakeDb({ fail: "branches" }).db)).rejects.toThrow("分店查詢失敗");
    await expect(readOptionPreview(fakeDb({ fail: "menu_item_options" }).db)).rejects.toThrow("請使用 SQL 預覽");
  });

  it("fails rather than silently dropping missing joins or unordered rows", async () => {
    await expect(readOptionPreview(fakeDb({ missingItem: true }).db)).rejects.toThrow("選項關聯或價格無法讀取");
    await expect(readOptionPreview(fakeDb({ unordered: true }).db)).rejects.toThrow("預覽排序不一致");
  });

  it("renders the JSON mode as one parseable document", async () => {
    const { rows, names } = await readOptionPreview(fakeDb().db);
    const plan = planOptionSetMerge(rows);
    expect(JSON.parse(renderOptionPreview(plan, names, true))).toEqual(plan);
  });

  it("stops without a partial result if pages never reach the end", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      return new Response(JSON.stringify([option(String(calls).padStart(6, "0"))]), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    };
    const db = createClient("http://127.0.0.1:1", "placeholder", { global: { fetch: fetcher } });
    await expect(readOptionPreview(db)).rejects.toThrow("超過分頁上限");
    expect(calls).toBe(1000);
  });
});
