import { test, expect, type Page } from "@playwright/test";
import { seedAdminSession } from "./helpers/admin-session";

const base = {
  room_id: "room-1", customer_name: "逾期釋放客人", phone: "0912345678", email: null,
  start_time: "2026-10-10T04:00:00.000Z", end_time: "2026-10-10T06:00:00.000Z",
  total_price: 2000, guest_count: 4, notes: null, is_notified: false, is_deposit_paid: false,
  line_user_id: null, created_at: "2026-10-01T02:00:00.000Z",
  room_with_branch: { id: "room-1", name: "包廂 A", branch: { name: "大安店" } },
};

async function mockApis(page: Page, restoreStatus: number, patches: unknown[]) {
  let rows = [{ ...base, id: "r-cancel-1", booking_code: "RST001", status: "cancelled" }];
  const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/branches**", (r) => r.fulfill(json([{ id: "branch-1", name: "大安店" }])));
  await page.route("**/api/settings**", (r) => r.fulfill(json({ current_branch_id: "branch-1" })));
  await page.route("**/api/rooms**", (r) => r.fulfill(json([{ id: "room-1", name: "包廂 A", branch_id: "branch-1", capacity: 8 }])));
  await page.route("**/api/reservations**", async (route) => {
    if (route.request().method() === "PATCH") {
      patches.push(JSON.parse(route.request().postData() ?? "{}"));
      if (restoreStatus === 200) rows = rows.map((r) => ({ ...r, status: "pending" }));
      await route.fulfill(json(restoreStatus === 200 ? { ok: true } : { error: "該時段已被預訂，請重新選擇" }, restoreStatus));
      return;
    }
    await route.fulfill(json(rows));
  });
}

test("歷史紀錄 → 還原 → 刷新後離開歷史", async ({ page, context }) => {
  await seedAdminSession(context);
  const patches: unknown[] = [];
  await mockApis(page, 200, patches);
  await page.goto("/admin");
  await page.getByRole("button", { name: "歷史紀錄" }).click();
  await expect(page.getByText("RST001")).toBeVisible();
  await page.getByRole("button", { name: /還原/ }).click();
  await page.getByRole("button", { name: "確認" }).click();
  await expect(page.getByText("RST001")).toBeHidden();
  expect(patches).toEqual([{ intent: "restore" }]);
});

test("時段被占：顯示錯誤、訂位留在歷史", async ({ page, context }) => {
  await seedAdminSession(context);
  const patches: unknown[] = [];
  await mockApis(page, 409, patches);
  await page.goto("/admin");
  await page.getByRole("button", { name: "歷史紀錄" }).click();
  await page.getByRole("button", { name: /還原/ }).click();
  await page.getByRole("button", { name: "確認" }).click();
  await expect(page.getByText("該時段已被預訂，請重新選擇")).toBeVisible();
  await expect(page.getByText("RST001")).toBeVisible();
});
