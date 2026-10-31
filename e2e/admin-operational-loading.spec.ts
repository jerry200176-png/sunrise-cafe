import { expect, test } from "@playwright/test";
import { seedAdminSession } from "./helpers/admin-session";

const branches = [
  { id: "b1", name: "甲店" },
  { id: "b2", name: "乙店" },
];

function todayBundle(name: string, branchId: string) {
  return {
    date: "2026-10-31", branchId, generated_at: new Date().toISOString(), timezone: "Asia/Taipei",
    summary: { today_count: 1, unpaid_deposit: 0, pending_payment_reviews: 0, arriving_soon: 0, at_risk_deadline: 0, waitlist_open: 0, waitlist_needs_call: 0 },
    timeline: { date: "2026-10-31", branchName: "E2E", openTime: "09:00", closeTime: "21:00", rooms: [] },
    upcoming: [{ id: `r-${branchId}`, booking_code: "A12345", customer_name: name, phone: "0912345678", room_name: "小包廂", start_time: "2026-10-31T04:00:00.000Z", end_time: "2026-10-31T06:00:00.000Z", status: "confirmed", is_deposit_paid: false, guest_confirmed_at: null, hours_until_start: 1 }],
    unpaid: [], payment_reviews: [], waitlist: [], partial_errors: [],
    task_hops: { review_payment: { before: 0, after: 0 }, call_unpaid: { before: 0, after: 0 }, call_waitlist: { before: 0, after: 0 } },
  };
}

async function seed(page: import("@playwright/test").Page, context: import("@playwright/test").BrowserContext) {
  await seedAdminSession(context);
  await page.route("**/api/branches**", async (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(branches),
  }));
}

test("今日場控分店 API 503 可重試恢復，空分店清單結束載入", async ({ page, context }) => {
  await seedAdminSession(context);
  let attempts = 0;
  await page.route("**/api/branches**", async (route) => {
    attempts++;
    if (attempts === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporarily unavailable" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.goto("/admin/today");
  await expect(page.getByText(/無法載入分店/)).toBeVisible();
  await page.getByRole("button", { name: "重試" }).click();
  await expect(page.getByRole("status")).toContainText("目前沒有可管理的分店");
  await expect(page.getByLabel("載入今日場控")).toHaveCount(0);
});

test("今日場控切店倒序回應不會顯示舊分店資料", async ({ page, context }) => {
  await seed(page, context);
  let resolveFirst: (() => void) | undefined;
  let firstStartedResolve: (() => void) | undefined;
  const firstStarted = new Promise<void>((resolve) => { firstStartedResolve = resolve; });
  const firstRelease = new Promise<void>((resolve) => { resolveFirst = resolve; });
  await page.route("**/api/admin/today**", async (route) => {
    const branchId = new URL(route.request().url()).searchParams.get("branchId") ?? "";
    if (branchId === "b1") {
      firstStartedResolve?.();
      await firstRelease;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(todayBundle("甲店客人", branchId)) });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(todayBundle("乙店客人", branchId)) });
    }
  });
  await page.goto("/admin/today");
  await firstStarted;
  await page.getByLabel("分店").selectOption("b2");
  await expect(page.getByText("乙店客人")).toBeVisible();
  resolveFirst?.();
  await expect(page.getByText("甲店客人")).toHaveCount(0);
  await expect(page.getByText("乙店客人")).toBeVisible();
});

test("訂單看板倒序回應不會覆蓋目前分店的訂單", async ({ page, context }) => {
  await seed(page, context);
  let resolveFirst: (() => void) | undefined;
  let firstStartedResolve: (() => void) | undefined;
  const firstStarted = new Promise<void>((resolve) => { firstStartedResolve = resolve; });
  const firstRelease = new Promise<void>((resolve) => { resolveFirst = resolve; });
  await page.route("**/api/admin/orders**", async (route) => {
    const branchId = new URL(route.request().url()).searchParams.get("branchId") ?? "";
    if (branchId === "b1") {
      firstStartedResolve?.();
      await firstRelease;
    }
    const item = branchId === "b1" ? "甲店餐點" : "乙店餐點";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{
      id: branchId, status: "pending", created_at: new Date().toISOString(), total_amount: 100,
      table: { number: branchId === "b1" ? "1" : "2" }, order_items: [{ id: `i-${branchId}`, item_name: item, quantity: 1 }],
    }], nextCursor: null }) });
  });
  await page.goto("/admin/orders");
  await firstStarted;
  await page.getByRole("combobox").selectOption("b2");
  await expect(page.getByText("乙店餐點")).toBeVisible();
  resolveFirst?.();
  await expect(page.getByText("甲店餐點")).toHaveCount(0);
  await expect(page.getByText("乙店餐點")).toBeVisible();
});
