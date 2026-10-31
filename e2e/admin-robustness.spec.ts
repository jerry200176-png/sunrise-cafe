import { test, expect, type Page } from "@playwright/test";
import { seedAdminSession } from "./helpers/admin-session";

const BRANCH = { id: "b1", name: "E2E 店" };
const now = () => new Date().toISOString();
const order = (over: Record<string, unknown> = {}) => ({
  id: "o1", branch_id: "b1", table_id: "t1", status: "pending", total_amount: 120, notes: null, is_printed: false,
  created_at: now(), table: { number: "A1" },
  order_items: [{ id: "i1", order_id: "o1", item_name: "拿鐵", quantity: 1, unit_price: 120, selected_options: null, special_notes: null }],
  ...over,
});

async function base(page: Page) {
  await page.route("**/api/branches", (r) => r.fulfill({ json: [BRANCH] }));
}

test.describe("後台穩定性", () => {
  test("登入過期：顯示重新登入提示，而不是『沒有訂單』", async ({ page, context }) => {
    await seedAdminSession(context);
    await base(page);
    await page.route("**/api/admin/orders?**", (r) => r.fulfill({ status: 401, json: { error: "Unauthorized" } }));
    await page.goto("/admin/orders");
    await expect(page.getByRole("alert").filter({ hasText: "畫面上的資料不是最新的" })).toBeVisible();
    await expect(page.getByRole("link", { name: "重新登入" })).toBeVisible();
  });

  test("訂單狀態更新失敗：卡片留在看板並顯示錯誤；提示音有真的音檔", async ({ page, context }) => {
    await seedAdminSession(context);
    await base(page);
    await page.route("**/api/admin/orders?**", (r) => r.fulfill({ json: { items: [order()], nextCursor: null } }));
    await page.route("**/api/admin/orders/o1", (r) => r.fulfill({ status: 500, json: { error: "boom" } }));
    await page.goto("/admin/orders");
    await expect(page.getByText("拿鐵")).toBeVisible();
    await expect(page.locator("audio")).toHaveAttribute("src", "/sounds/new-order.wav");
    expect((await page.request.get("/sounds/new-order.wav")).ok()).toBe(true);
    await page.getByRole("button", { name: /開始備餐/ }).first().click();
    await expect(page.getByRole("alert").filter({ hasText: "訂單沒有更新" })).toBeVisible();
    await expect(page.getByText("拿鐵")).toBeVisible();
  });

  test("列印站：定時補印漏掉的單，略過還沒寫入餐點的空單，成功後標記已列印", async ({ page, context }) => {
    await seedAdminSession(context);
    await base(page);
    await page.clock.install();
    const printed: string[] = [];
    const marked: string[] = [];
    await page.route("**/api/admin/orders?**", (r) =>
      r.fulfill({ json: { items: [order({ id: "o1" }), order({ id: "empty", order_items: [] })], nextCursor: null } })
    );
    await page.route("**/api/admin/orders/*", (r) => {
      marked.push(new URL(r.request().url()).pathname.split("/").pop()!);
      return r.fulfill({ json: { ok: true } });
    });
    await page.route("http://localhost:22222/**", (r) => {
      printed.push(r.request().postData() ?? "");
      return r.fulfill({ status: 200, contentType: "text/xml", body: "<response>ok</response>" });
    });
    await page.goto("/admin/print-station");
    await page.getByRole("button", { name: /開始監聽/ }).click();
    await page.clock.fastForward(16_000);
    await expect.poll(() => marked).toEqual(["o1"]);
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain("拿鐵");
    await expect(page.getByText("印表機正常", { exact: true })).toBeVisible();
  });

  test("列印站：印表機沒回應時狀態燈變紅並說明", async ({ page, context }) => {
    await seedAdminSession(context);
    await base(page);
    await page.clock.install();
    await page.route("**/api/admin/orders?**", (r) => r.fulfill({ json: { items: [order()], nextCursor: null } }));
    await page.route("http://localhost:22222/**", (r) => r.abort());
    await page.goto("/admin/print-station");
    await page.getByRole("button", { name: /開始監聽/ }).click();
    await page.clock.fastForward(16_000);
    await expect(page.getByRole("alert").filter({ hasText: "印表機沒回應" })).toBeVisible();
  });
});
