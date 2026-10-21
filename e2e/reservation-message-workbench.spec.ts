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

const reservation2 = {
  ...reservation,
  id: "r-message-2",
  booking_code: "MSG002",
  start_time: "2026-08-21T04:00:00.000Z",
  end_time: "2026-08-21T06:00:00.000Z",
};

const reservationDifferentContact = {
  ...reservation2,
  id: "r-message-3",
  booking_code: "MSG003",
  phone: "0987654321",
};

async function mockReservationApis(
  page: Page,
  actions: Array<Record<string, unknown>>,
  reservations: Array<Record<string, unknown>> = [reservation]
) {
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
    if (url.pathname.endsWith("/message-actions/batch")) {
      const body = JSON.parse(route.request().postData() ?? "{}");
      const selected = reservations.filter((item) => body.reservation_ids.includes(item.id));
      const blocked = new Set(selected.map((item) => item.phone)).size > 1;
      if (body.action === "copied") actions.push(body);
      await route.fulfill({
        status: body.action === "copied" && blocked ? 409 : 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: !blocked,
          batch_id: "batch-e2e-1",
          can_batch_copy: !blocked,
          warnings: blocked ? ["選取的訂位不是同一位客人／聯絡資料，無法複製全部。"] : [],
          items: selected.map((item) => ({
            reservation_id: item.id,
            customer_name: item.customer_name,
            date_label: item.start_time === reservation.start_time ? "2026/08/20 (週四)" : "2026/08/21 (週五)",
            start_time: item.start_time,
            end_time: item.end_time,
            booking_code: item.booking_code,
            deposit_amount: 1000,
            text: `canonical ${item.booking_code}`,
          })),
          combined_text: selected.map((item, index) => `===== 第 ${index + 1} 筆訂位 =====\ncanonical ${item.booking_code}`).join("\n\n"),
          action_ids: selected.map((_, index) => `batch-a-${index + 1}`),
        }),
      });
      return;
    }
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
    // GET /api/reservations 回傳 { items, nextCursor, total, warnings }；這些訂位都是未結案（scope=active）
    const items = url.searchParams.get("scope") === "active" ? reservations : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items, nextCursor: null, total: items.length, warnings: [] }),
    });
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

test("同一客人的多天訂位可預覽、複製全部與逐筆複製", async ({ page, context }) => {
  await seedAdminSession(context);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const actions: Array<Record<string, unknown>> = [];
  await mockReservationApis(page, actions, [reservation, reservation2]);

  await page.goto("/admin");
  await page.getByRole("checkbox", { name: /未綁 LINE 客人 MSG001/ }).check();
  await page.getByRole("checkbox", { name: /未綁 LINE 客人 MSG002/ }).check();
  await page.getByRole("button", { name: "批次複製訂金訊息" }).click();

  await expect(page.getByRole("heading", { name: "批次複製訂金訊息" })).toBeVisible();
  await expect(page.getByText("訂位碼：MSG001")).toBeVisible();
  await expect(page.getByText("訂位碼：MSG002")).toBeVisible();
  await page.getByRole("button", { name: "複製全部" }).click();
  await expect(page.getByText(/已複製全部訊息/)).toBeVisible();
  expect(actions.at(-1)).toMatchObject({ action: "copied", reservation_ids: ["r-message-1", "r-message-2"] });

  await page.getByRole("button", { name: "單獨複製" }).first().click();
  await expect(page.getByText(/已複製；已複製不等於已傳送/)).toBeVisible();
});

test("不同聯絡資料只顯示警告並阻止複製全部", async ({ page, context }) => {
  await seedAdminSession(context);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const actions: Array<Record<string, unknown>> = [];
  await mockReservationApis(page, actions, [reservation, reservationDifferentContact]);

  await page.goto("/admin");
  await page.getByRole("checkbox", { name: /未綁 LINE 客人 MSG001/ }).check();
  await page.getByRole("checkbox", { name: /未綁 LINE 客人 MSG003/ }).check();
  await page.getByRole("button", { name: "批次複製訂金訊息" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "不能複製全部" })).toBeVisible();
  await expect(page.getByRole("button", { name: "複製全部" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "單獨複製" }).first()).toBeEnabled();
  expect(actions).toHaveLength(0);
});
