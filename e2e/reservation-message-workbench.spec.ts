import { test, expect, type Page } from "@playwright/test";
import { seedAdminSession } from "./helpers/admin-session";

const reservation = {
  id: "r-message-1",
  booking_code: "MSG001",
  room_id: "room-1",
  customer_name: "未綁 LINE 客人",
  phone: "0912345678",
  email: null,
  start_time: "2026-08-20T04:00:00.000Z",
  end_time: "2026-08-20T06:00:00.000Z",
  status: "pending",
  total_price: 2000,
  guest_count: 4,
  notes: null,
  is_notified: false,
  is_deposit_paid: false,
  line_user_id: null,
  created_at: "2026-08-13T02:00:00.000Z",
  room_with_branch: { id: "room-1", name: "包廂 A", branch: { name: "大安店" } },
};

async function mockReservationApis(page: Page, actions: Array<Record<string, unknown>>) {
  await page.route("**/api/branches**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "branch-1",
          name: "大安店",
          display_name: "昇昇咖啡（大安店）",
          payment_info: "銀行：測試銀行 123",
          line_pay_url: "https://pay.example/msg",
        },
      ]),
    });
  });
  await page.route("**/api/settings**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ current_branch_id: "branch-1" }) });
  });
  await page.route("**/api/rooms**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: "room-1", name: "包廂 A", branch_id: "branch-1", capacity: 8 }]) });
  });
  await page.route("**/api/reservations**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/message-actions")) {
      if (route.request().method() === "POST") {
        const body = JSON.parse(route.request().postData() ?? "{}");
        actions.push(body);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, action_id: `a-${actions.length}`, text: "canonical message" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, template_key: "booking_confirmation", text: "canonical message" }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([reservation]) });
  });
}

test("未綁 LINE 客人可複製訊息並留下人工傳送紀錄", async ({ page, context }) => {
  await seedAdminSession(context);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const actions: Array<Record<string, unknown>> = [];
  await mockReservationApis(page, actions);

  await page.goto("/admin");
  await page.getByRole("button", { name: "訊息工作台" }).click();
  await expect(page.getByRole("heading", { name: "訊息工作台" })).toBeVisible();
  await expect(page.getByText("尚未綁定官方 LINE")).toBeVisible();
  await expect(page.locator("#reservation-message-preview")).toHaveValue("canonical message");

  await page.getByRole("button", { name: "產生並複製" }).click();
  const markSent = page.getByRole("button", { name: "標記已傳送" });
  await expect(markSent).toBeEnabled();
  await markSent.click();
  await expect(page.getByText("已記錄人工傳送")).toBeVisible();
  expect(actions.map((action) => action.action)).toEqual(["copied", "manual_sent"]);
});
