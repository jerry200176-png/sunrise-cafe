import { test, expect } from "@playwright/test";
import { seedAdminSession } from "./helpers/admin-session";

const report = {
  summary: {
    received_deposits: 4000, received_orders: 1500, expected_upcoming: 9000, unpaid_deposits: 2500, bookings: 20,
    cancellation_count: 3, cancellation_rate: 0.13, deposit_paid_count: 15, deposit_rate: 0.75, guests: 78, cancelled: 3,
  },
  monthly: [{ month: "2026-10", label: "10 月", bookings: 20, received_deposits: 4000, received_orders: 1500 }],
  by_room: [{ name: "A包廂", bookings: 12, booked_amount: 12000 }],
  by_hour: [{ hour: 14, label: "14:00", count: 5 }],
};

test("營收報表：實收與預計分開、不加總；訂金收款率分母等於訂位數；可選分店", async ({ page, context }) => {
  await seedAdminSession(context);
  await page.route("**/api/branches", (r) => r.fulfill({ json: [{ id: "b1", name: "E2E 店" }] }));
  const urls: string[] = [];
  await page.route("**/api/admin/reports**", (r) => {
    urls.push(r.request().url());
    return r.fulfill({ json: report });
  });
  await page.goto("/admin/reports");
  await expect(page.getByText("已收訂金")).toBeVisible();
  await expect(page.getByText("$4,000").first()).toBeVisible();
  await expect(page.getByText("$1,500").first()).toBeVisible();
  await expect(page.getByText("$5,500")).toHaveCount(0);
  await expect(page.getByText("總營收")).toHaveCount(0);
  await expect(page.getByText("15 / 20 筆已付訂金")).toBeVisible();
  await page.getByLabel("分店").selectOption("b1");
  await expect.poll(() => urls.some((u) => u.includes("branchId=b1"))).toBe(true);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /匯出/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^昇咖啡營收報表-\d\d-\d\d\.csv$/);
});
