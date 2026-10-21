import { test, expect } from "@playwright/test";
import { seedAdminSession } from "./helpers/admin-session";

test.describe("後台首頁", () => {
  test("訂位列表在最上面，店務設定在下面；底部導覽有「訂位」", async ({ page, context }) => {
    await seedAdminSession(context);
    await page.route(/\/api\/branches(\?.*)?$/, (r) =>
      r.fulfill({ json: [{ id: "b1", name: "E2E 店", closed_dates: [] }] })
    );
    await page.route("**/api/reservations**", (r) => r.fulfill({ json: { items: [], nextCursor: null, total: 0, warnings: [] } }));
    await page.goto("/admin");
    const list = page.getByRole("heading", { name: "訂位列表" });
    const tiles = page.getByText("今日營運", { exact: true });
    await expect(list).toBeVisible();
    const [a, b] = [await list.boundingBox(), await tiles.boundingBox()];
    expect(a!.y).toBeLessThan(b!.y);
    await expect(page.getByRole("navigation", { name: "後台導覽" }).getByRole("link", { name: "訂位" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });
});
