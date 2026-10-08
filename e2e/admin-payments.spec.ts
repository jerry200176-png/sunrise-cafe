import { test, expect, type Page } from "@playwright/test";
import { seedAdminSession } from "./helpers/admin-session";

const PENDING = {
  id: "p1", reservation_id: "r1", booking_code: "AB12", customer_name: "王小明", phone: "0912345678",
  start_time: "2026-10-09T10:00:00Z", deposit_amount: 500, reservation_status: "pending",
  created_at: "2026-10-08T01:00:00Z", raw_payload: "已匯款", source: "line_text", is_deposit_paid: false,
  reported_account_last_five: null, reported_amount: null, reported_at: null,
};

async function setup(page: Page) {
  const calls = { approve: 0, reject: 0 };
  await page.route("**/api/admin/payments/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    if (p.endsWith("/migration-status")) return json({ payment_events_ready: true });
    if (p.endsWith("/pending")) return json([PENDING]);
    if (p.endsWith("/reconcile")) return json({ items: [] });
    if (p.endsWith("/approve")) {
      calls.approve++;
      await new Promise((r) => setTimeout(r, 400));
      return json({ ok: true, notification: null });
    }
    if (p.endsWith("/reject")) { calls.reject++; return json({ ok: true }); }
    return json({});
  });
  return calls;
}

test.describe("付款審核安全", () => {
  test("焦點在「駁回」按 Enter 只會開啟駁回欄，不會核准", async ({ page, context }) => {
    await seedAdminSession(context);
    const calls = await setup(page);
    await page.goto("/admin/payments");
    await page.getByRole("button", { name: "駁回" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByPlaceholder("駁回原因（必填）")).toBeVisible();
    expect(calls.approve).toBe(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("核准要先確認，連按只送出一次", async ({ page, context }) => {
    await seedAdminSession(context);
    const calls = await setup(page);
    await page.goto("/admin/payments");
    await page.getByRole("button", { name: "確認已收款" }).click();
    await expect(page.getByRole("dialog")).toContainText("王小明");
    expect(calls.approve).toBe(0);
    await page.getByRole("dialog").getByRole("button", { name: "確認已收款" }).dblclick();
    await expect(page.getByText("已確認收款")).toBeVisible();
    expect(calls.approve).toBe(1);
  });

  test("鍵盤 Enter 在頁面空白處也只開確認視窗", async ({ page, context }) => {
    await seedAdminSession(context);
    const calls = await setup(page);
    await page.goto("/admin/payments");
    await expect(page.getByText("王小明")).toBeVisible();
    await page.locator("body").press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(calls.approve).toBe(0);
  });
});
