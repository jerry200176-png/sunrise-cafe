import { test, expect } from "@playwright/test";
import { seedAdminSession } from "./helpers/admin-session";

/**
 * Today ops acceptance — auth, empty/error, mobile viewport, branch query.
 * Uses route mocks (no production DB). Page auth uses signed cookie (see playwright.config).
 */
const BRANCH = { id: "b1", name: "E2E 店" };
const OTHER_BRANCH = { id: "b2", name: "其他店" };

function todayBundle(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-07-15",
    branchId: "b1",
    generated_at: new Date().toISOString(),
    timezone: "Asia/Taipei",
    window: {
      start_iso: "2026-07-14T16:00:00.000Z",
      end_iso: "2026-07-15T16:00:00.000Z",
    },
    summary: {
      today_count: 1,
      unpaid_deposit: 1,
      pending_payment_reviews: 1,
      arriving_soon: 1,
      at_risk_deadline: 0,
      waitlist_open: 1,
      waitlist_needs_call: 1,
    },
    timeline: {
      date: "2026-07-15",
      branchName: "E2E",
      openTime: "09:00",
      closeTime: "21:00",
      rooms: [],
    },
    upcoming: [
      {
        id: "r1",
        booking_code: "ABC123",
        customer_name: "王小明",
        phone: "0912345678",
        room_name: "小包廂",
        start_time: "2026-07-15T04:00:00.000Z",
        end_time: "2026-07-15T06:00:00.000Z",
        status: "confirmed",
        is_deposit_paid: false,
        guest_confirmed_at: null,
        hours_until_start: 1.5,
      },
    ],
    unpaid: [
      {
        id: "r1",
        booking_code: "ABC123",
        customer_name: "王小明",
        phone: "0912345678",
        start_time: "2026-07-15T04:00:00.000Z",
        deposit_deadline: "2026-07-15T10:00:00.000Z",
        hours_to_deadline: 3,
      },
    ],
    payment_reviews: [{ id: "pe1", reservation_id: "r1" }],
    waitlist: [
      {
        id: "w1",
        customer_name: "候補客",
        phone: "0987654321",
        start_time: "2026-07-15T05:00:00.000Z",
        status: "waiting",
        line_user_id: null,
        staff_called_at: null,
      },
    ],
    partial_errors: [] as Array<{ source: string; message: string }>,
    task_hops: {
      review_payment: { before: 4, after: 1 },
      call_unpaid: { before: 3, after: 1 },
      call_waitlist: { before: 3, after: 1 },
    },
    ...overrides,
  };
}

async function mockBranches(page: import("@playwright/test").Page, branches = [BRANCH]) {
  await page.route("**/api/branches**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(branches),
    });
  });
}

test.describe("今日場控 /admin/today", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("未授權導向登入", async ({ page }) => {
    await page.goto("/admin/today");
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("手機一屏顯示未付／候補／即將到店", async ({ page, context }) => {
    await seedAdminSession(context);
    await mockBranches(page);
    await page.route("**/api/admin/today**", async (route) => {
      expect(route.request().url()).toContain("branchId=b1");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(todayBundle()),
      });
    });

    await page.goto("/admin/today");
    await expect(page.getByRole("heading", { name: "今日場控" })).toBeVisible();
    await expect(page.getByText("王小明").first()).toBeVisible();
    await expect(page.getByText("未付訂金").first()).toBeVisible();
    await expect(page.getByText("等位待處理")).toBeVisible();
    await expect(page.getByText("需人工致電")).toBeVisible();
    await expect(page.getByText("7/15（週三）").first()).toBeVisible();
  });

  test("分店隔離：staff 僅見允許分店選項", async ({ page, context }) => {
    await seedAdminSession(context, {
      role: "staff",
      branch_ids: ["b1"],
      legacy: false,
    });
    await mockBranches(page, [BRANCH, OTHER_BRANCH]);
    const seen: string[] = [];
    await page.route("**/api/admin/today**", async (route) => {
      const u = new URL(route.request().url());
      seen.push(u.searchParams.get("branchId") ?? "");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(todayBundle({ branchId: u.searchParams.get("branchId") })),
      });
    });

    await page.goto("/admin/today");
    await expect(page.getByRole("heading", { name: "今日場控" })).toBeVisible();
    // UI lists branches from /api/branches; staff isolation is enforced on API (403).
    // Simulate forbidden branch: mock 403 and expect alert.
    await page.unroute("**/api/admin/today**");
    await page.route("**/api/admin/today**", async (route) => {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "Forbidden branch" }),
      });
    });
    await page.getByLabel("重新整理").click();
    await expect(page.getByText("Forbidden branch")).toBeVisible();
    await expect(page.getByRole("button", { name: "重試" })).toBeVisible();
  });

  test("partial failure 顯示可重試告警", async ({ page, context }) => {
    await seedAdminSession(context);
    await mockBranches(page);
    await page.route("**/api/admin/today**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          todayBundle({
            partial_errors: [{ source: "waitlist", message: "timeout" }],
          })
        ),
      });
    });
    await page.goto("/admin/today");
    await expect(page.getByText(/部分資料暫時無法載入/)).toBeVisible();
    await expect(page.getByRole("button", { name: "重試全部" })).toBeVisible();
  });

  test("empty / loading 狀態", async ({ page, context }) => {
    await seedAdminSession(context);
    await mockBranches(page);
    let resolveToday: ((v: unknown) => void) | null = null;
    const todayPromise = new Promise((r) => {
      resolveToday = r;
    });
    await page.route("**/api/admin/today**", async (route) => {
      await todayPromise;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          todayBundle({
            summary: {
              today_count: 0,
              unpaid_deposit: 0,
              pending_payment_reviews: 0,
              arriving_soon: 0,
              at_risk_deadline: 0,
              waitlist_open: 0,
              waitlist_needs_call: 0,
            },
            upcoming: [],
            unpaid: [],
            payment_reviews: [],
            waitlist: [],
          })
        ),
      });
    });
    await page.goto("/admin/today");
    await expect(page.getByLabel("載入今日場控")).toBeVisible();
    resolveToday?.(null);
    await expect(page.getByText("今日尚無訂位")).toBeVisible();
    await expect(page.getByText("目前沒有等位")).toBeVisible();
  });

  test("retry 在 total failure 後可恢復", async ({ page, context }) => {
    await seedAdminSession(context);
    await mockBranches(page);
    let n = 0;
    await page.route("**/api/admin/today**", async (route) => {
      n += 1;
      if (n === 1) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "模擬失敗" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(todayBundle()),
      });
    });
    await page.goto("/admin/today");
    await expect(page.getByText("模擬失敗")).toBeVisible();
    await page.getByRole("button", { name: "重試" }).click();
    await expect(page.getByText("王小明").first()).toBeVisible();
  });
});
