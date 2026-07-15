import { test, expect } from "@playwright/test";
import { seedAdminSession } from "./helpers/admin-session";

/**
 * Today ops acceptance — auth, empty/error, mobile viewport, branch query.
 * Uses route mocks (no production DB). Page auth uses signed cookie (see playwright.config).
 *
 * Production phone checklist (manual after login on device):
 * 1) Open /admin/today on 390×844 — no horizontal scroll
 * 2) Confirm date = Taipei today; unpaid / reviews / waitlist / upcoming match store
 * 3) Call unpaid (tel:) and call waitlist = 1 hop each from screen
 * 4) Payment review link lands on /admin/payments
 * 5) Switch branch (if multi) — data swaps; forbidden branch shows error
 * 6) Pull refresh recovers from simulated offline
 */
const BRANCH = { id: "b1", name: "E2E 店" };
const OTHER_BRANCH = { id: "b2", name: "其他店" };

/** Asia/Taipei calendar day 2026-07-15 → UTC instants (unit-tested in admin-today.test.ts) */
const TAIPEI_DAY = {
  start_iso: "2026-07-14T16:00:00.000Z",
  end_iso: "2026-07-15T16:00:00.000Z",
};

function todayBundle(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-07-15",
    branchId: "b1",
    generated_at: new Date().toISOString(),
    timezone: "Asia/Taipei",
    window: TAIPEI_DAY,
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

  test("手機一屏：未付／待審核／候補／即將到店／Taipei／步數", async ({ page, context }) => {
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
    await expect(page.getByText("待審核").first()).toBeVisible();
    await expect(page.getByText("候補待處理")).toBeVisible();
    await expect(page.getByText("需人工致電")).toBeVisible();
    await expect(page.getByText(/高頻任務跳轉/)).toBeVisible();
    await expect(page.getByText(/付款審核 4→1/)).toBeVisible();
    await expect(page.getByText(/Asia\/Taipei/)).toBeVisible();
    await expect(page.getByText("2026-07-15").first()).toBeVisible();

    const noHScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2
    );
    expect(noHScroll).toBe(true);

    // Core task hops: tel: and review link present from this screen
    await expect(page.locator('a[href^="tel:"]').first()).toBeVisible();
    await expect(page.getByRole("link", { name: /付款審核/ })).toHaveAttribute(
      "href",
      "/admin/payments"
    );
  });

  test("分店隔離：forbidden branch 顯示錯誤可重試", async ({ page, context }) => {
    await seedAdminSession(context, {
      role: "staff",
      branch_ids: ["b1"],
      legacy: false,
    });
    await mockBranches(page, [BRANCH, OTHER_BRANCH]);
    await page.route("**/api/admin/today**", async (route) => {
      const u = new URL(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(todayBundle({ branchId: u.searchParams.get("branchId") })),
      });
    });

    await page.goto("/admin/today");
    await expect(page.getByRole("heading", { name: "今日場控" })).toBeVisible();
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

  test("unauthorized role session 無法進入場控頁", async ({ page, context }) => {
    // Expired/invalid cookie → middleware login redirect
    await context.addCookies([
      {
        name: "admin_session",
        value: "invalid.signature",
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
      },
    ]);
    await page.goto("/admin/today");
    await expect(page).toHaveURL(/\/admin\/login/);
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
    await expect(page.getByText("目前無候補")).toBeVisible();
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

test.describe("Production phone acceptance (opt-in)", () => {
  test.skip(!process.env.E2E_PROD_TODAY, "set E2E_PROD_TODAY=1 + E2E_ADMIN_PASSWORD against live URL");
  test.use({
    viewport: { width: 390, height: 844 },
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "https://sunrise-cafe-six.vercel.app",
  });

  test("登入後場控頁載入且無水平溢出", async ({ page }) => {
    await page.goto("/admin/login");
    await page.locator("input[type='password']").fill(process.env.E2E_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /登入/ }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15_000 });
    await page.goto("/admin/today");
    await expect(page.getByRole("heading", { name: "今日場控" })).toBeVisible({
      timeout: 20_000,
    });
    const noHScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2
    );
    expect(noHScroll).toBe(true);
  });
});
