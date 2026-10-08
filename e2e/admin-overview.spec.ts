import { test, expect } from "@playwright/test";
import { seedAdminSession } from "./helpers/admin-session";

const part = (label: string, o: Record<string, number | null> = {}) => ({
  label, received_deposits: 4000, received_orders: 1500, expected_upcoming: 9000, unpaid_deposits: 2500,
  bookings: 20, guests: 78, cancelled: 3, deposit_paid_count: 15, deposit_rate: 0.75, ...o,
});

test("經營總覽：實收與預計分開顯示，不出現工程用語", async ({ page, context }) => {
  await seedAdminSession(context);
  await page.route("**/api/branches", (r) => r.fulfill({ json: [{ id: "b1", name: "E2E 店" }] }));
  const seen: string[] = [];
  await page.route("**/api/admin/overview**", (r) => {
    seen.push(r.request().url());
    return r.fulfill({ json: { this_month: part("10 月"), last_month: part("9 月", { received_deposits: 3000 }) } });
  });
  await page.goto("/admin/executive");
  await expect(page.getByRole("heading", { name: "經營總覽" })).toBeVisible();
  await expect(page.getByText("NT$4,000").first()).toBeVisible();
  await expect(page.getByText("NT$1,500").first()).toBeVisible();
  await expect(page.getByText("NT$9,000").first()).toBeVisible();
  await expect(page.getByText("NT$5,500")).toHaveCount(0); // 4000 + 1500：實收兩項不加總
  await expect(page.getByText("75%").first()).toBeVisible();
  for (const jargon of ["SHA", "Cron", "migration", "bi:read", "North Star"]) {
    await expect(page.getByText(jargon, { exact: false })).toHaveCount(0);
  }
  await page.getByLabel("分店").selectOption("b1");
  await expect.poll(() => seen.some((u) => u.includes("branchId=b1"))).toBe(true);
});
