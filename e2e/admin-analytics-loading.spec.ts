import { test, expect } from "@playwright/test";
import { seedAdminSession } from "./helpers/admin-session";

const branchRows = [
  { id: "b1", name: "大安店" },
  { id: "b2", name: "信義店" },
];

const overview = (label: string, deposits = 4000) => {
  const part = {
    label, received_deposits: deposits, received_orders: 1500, expected_upcoming: 9000,
    unpaid_deposits: 2500, bookings: 20, guests: 78, cancelled: 3,
    deposit_paid_count: 15, deposit_rate: 0.75,
  };
  return { this_month: part, last_month: { ...part, label: "上月" } };
};

const report = (deposits: number) => ({
  summary: {
    received_deposits: deposits, received_orders: 1500, expected_upcoming: 9000,
    unpaid_deposits: 2500, bookings: 20, cancellation_count: 3,
    cancellation_rate: 0.13, deposit_paid_count: 15, deposit_rate: 0.75,
  },
  monthly: [], by_room: [], by_hour: [],
});

test("經營總覽：分店清單暫時失敗會顯示重試，恢復後可選店", async ({ page, context }) => {
  await seedAdminSession(context);
  let attempts = 0;
  await page.route("**/api/branches", (route) => {
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 503, json: { error: "暫時無法載入分店" } })
      : route.fulfill({ json: branchRows });
  });
  const overviewUrls: string[] = [];
  await page.route("**/api/admin/overview**", (route) => {
    overviewUrls.push(route.request().url());
    return route.fulfill({ json: overview("本月") });
  });

  await page.goto("/admin/executive");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("暫時無法載入分店");
  await alert.getByRole("button", { name: "重試載入分店" }).click();
  await expect(page.getByLabel("分店")).toHaveValue("");
  await expect(page.getByLabel("分店").locator("option", { hasText: "大安店" })).toHaveCount(1);
  await page.getByLabel("分店").selectOption("b2");
  await expect.poll(() => overviewUrls.some((url) => url.includes("branchId=b2"))).toBe(true);
  await expect(page.getByText("NT$4,000").first()).toBeVisible();
});

test("儀表板：切分店後較慢的舊回應不會覆蓋新分店", async ({ page, context }) => {
  await seedAdminSession(context);
  await page.route("**/api/branches", (route) => route.fulfill({ json: branchRows }));
  await page.route("**/api/admin/reminders", (route) => route.fulfill({ json: [] }));

  let oldStarted!: () => void;
  const oldRequestStarted = new Promise<void>((resolve) => { oldStarted = resolve; });
  let releaseOld!: () => void;
  const oldResponseReleased = new Promise<void>((resolve) => { releaseOld = resolve; });
  await page.route("**/api/admin/dashboard**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("branchId") === "b1") {
      oldStarted();
      await oldResponseReleased;
      await route.fulfill({ json: { stats: { todayCount: 11, todayRevenue: 1100, roomsInUseCount: 1, totalRooms: 2 }, timeline: { date: "2026-10-31", branchName: "大安店", openTime: "09:00", closeTime: "21:00", rooms: [] }, trend: { points: [] } } });
      return;
    }
    await route.fulfill({ json: { stats: { todayCount: 22, todayRevenue: 2200, roomsInUseCount: 2, totalRooms: 3 }, timeline: { date: "2026-10-31", branchName: "信義店", openTime: "09:00", closeTime: "21:00", rooms: [] }, trend: { points: [] } } });
  });

  await page.goto("/admin/dashboard");
  await oldRequestStarted;
  await page.getByLabel("分店").selectOption("b2");
  await expect(page.getByText("時間軸 · 信義店")).toBeVisible();
  releaseOld();
  await expect(page.getByText("時間軸 · 大安店")).toHaveCount(0);
  await expect(page.getByText("時間軸 · 信義店")).toBeVisible();
});

test("營收報表：切期間後較慢的舊回應不會覆蓋目前報表", async ({ page, context }) => {
  await seedAdminSession(context);
  await page.route("**/api/branches", (route) => route.fulfill({ json: branchRows }));

  let oldStarted!: () => void;
  const oldRequestStarted = new Promise<void>((resolve) => { oldStarted = resolve; });
  let releaseOld!: () => void;
  const oldResponseReleased = new Promise<void>((resolve) => { releaseOld = resolve; });
  await page.route("**/api/admin/reports**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("months") === "6") {
      oldStarted();
      await oldResponseReleased;
      await route.fulfill({ json: report(4000) });
      return;
    }
    await route.fulfill({ json: report(5000) });
  });

  await page.goto("/admin/reports");
  await oldRequestStarted;
  await page.getByRole("button", { name: "近 3 個月" }).click();
  await expect(page.getByText("$5,000").first()).toBeVisible();
  releaseOld();
  await expect(page.getByText("$4,000")).toHaveCount(0);
  await expect(page.getByText("$5,000").first()).toBeVisible();
});
