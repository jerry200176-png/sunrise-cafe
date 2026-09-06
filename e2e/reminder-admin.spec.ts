/**
 * Mobile + desktop checks for tomorrow-reminder admin surfaces.
 * Run: PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test e2e/reminder-admin.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import { seedAdminSession } from "./helpers/admin-session";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

async function noHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);
}

async function mockReminderApis(page: Page) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const y = tomorrow.getFullYear();
  const m = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const d = String(tomorrow.getDate()).padStart(2, "0");
  const start = `${y}-${m}-${d}T10:00:00+08:00`;
  const end = `${y}-${m}-${d}T12:00:00+08:00`;

  await page.route("**/api/branches**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: "b1", name: "大安店", line_group_id: "Cgroup1", display_name: "昇昇咖啡大安店" },
      ]),
    });
  });

  await page.route("**/api/settings**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ current_branch_id: "b1" }),
    });
  });

  await page.route("**/api/admin/dashboard**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        stats: { todayCount: 1, roomsInUseCount: 0, totalRooms: 1, todayRevenue: 0 },
        timeline: {
          branchName: "大安店",
          openTime: "10:00",
          closeTime: "22:00",
          rooms: [{
            roomId: "room1",
            roomName: "包廂 A",
            reservations: [{
              id: "r1",
              booking_code: "ABC123",
              customer_name: "測試客人",
              start_time: start,
              end_time: end,
              status: "confirmed",
              is_deposit_paid: false,
              guest_count: 4,
              total_price: 2000,
            }],
          }],
        },
        trend: { points: [] },
      }),
    });
  });

  await page.route("**/api/admin/reminders", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "r1",
          booking_code: "ABC123",
          customer_name: "測試客人",
          phone: "0912345678",
          email: null,
          start_time: start,
          end_time: end,
          branch_name: "大安店",
          room_name: "包廂 A",
          is_notified: false,
        },
      ]),
    });
  });

  await page.route("**/api/admin/reminders/send-line", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, sent: 1, message: "已發送 1 筆明日提醒（僅尚未通知的訂位）" }),
    });
  });

  await page.route("**/api/reservations**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "r1",
          booking_code: "ABC123",
          room_id: "room1",
          start_time: start,
          end_time: end,
          customer_name: "測試客人",
          phone: "0912345678",
          status: "confirmed",
          is_deposit_paid: true,
          is_notified: false,
          guest_count: 4,
          room: { id: "room1", name: "包廂 A", branch: { id: "b1", name: "大安店" } },
        },
      ]),
    });
  });

  await page.route("**/api/rooms**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "room1", name: "包廂 A", branch_id: "b1", capacity: 8 }]),
    });
  });
}

for (const vp of VIEWPORTS) {
  test.describe(`Tomorrow reminder UI — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page, context }) => {
      await seedAdminSession(context);
      await page.goto("/admin");
    });

    test("儀表板明日提醒區塊可讀、無水平溢出、觸控夠大", async ({ page }) => {
      await mockReminderApis(page);
      await page.goto("/admin/dashboard");
      await expect(page.getByRole("heading", { name: "明日提醒" })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("測試客人", { exact: true })).toBeVisible();
      const copyBtn = page.getByRole("button", { name: "複製提醒" });
      const markBtn = page.getByRole("button", { name: "標記已通知" });
      await expect(copyBtn).toBeVisible();
      await expect(markBtn).toBeVisible();
      const copyBox = await copyBtn.boundingBox();
      const markBox = await markBtn.boundingBox();
      expect(copyBox?.height ?? 0).toBeGreaterThanOrEqual(40);
      expect(markBox?.height ?? 0).toBeGreaterThanOrEqual(40);
      expect(await noHorizontalOverflow(page)).toBe(true);
    });

    test("訂位列表手動發送 LINE 明日提醒按鈕可用", async ({ page }) => {
      await mockReminderApis(page);
      await page.goto("/admin");
      const sendBtn = page.getByRole("button", { name: /發送 LINE 明日提醒/ });
      await expect(sendBtn).toBeVisible({ timeout: 15_000 });
      const box = await sendBtn.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
      expect(await noHorizontalOverflow(page)).toBe(true);

      await sendBtn.click();
      const confirm = page.getByRole("button", { name: /確定|確認|發送/ }).last();
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click();
      }
      await expect(page.getByText(/已發送|成功發送|明日提醒/).first()).toBeVisible({ timeout: 10_000 });
    });

    test("時間軸日期快捷鍵與訂金／狀態標籤可讀", async ({ page }) => {
      await mockReminderApis(page);
      await page.goto("/admin/dashboard");
      await expect(page.getByRole("heading", { name: /時間軸/ })).toBeVisible({ timeout: 15_000 });
      const mobileCard = page.locator("li:visible").filter({ hasText: "測試客人" }).filter({ hasText: "已確認" }).filter({ hasText: "未付訂金" }).first();
      const desktopCard = page.locator('[title*="已確認"][title*="未付訂金"]:visible').first();
      await expect(mobileCard.or(desktopCard)).toBeVisible();

      const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(
        new Date(Date.now() + 24 * 60 * 60 * 1000)
      );
      const nextDashboard = page.waitForRequest((request) => {
        const url = new URL(request.url());
        return url.pathname === "/api/admin/dashboard" && url.searchParams.get("date") === tomorrow;
      });
      await page.getByRole("button", { name: "明天" }).click();
      await nextDashboard;
      await expect(page.getByText(tomorrow).first()).toBeVisible();
    });
  });
}
