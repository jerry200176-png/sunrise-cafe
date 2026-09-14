import { test, expect, type Page } from "@playwright/test";

const booking = {
  id: "isolated-payment-clarity", booking_code: "E2E001", room_id: "isolated-room",
  branch_id: "isolated-branch", room_name: "長中文包廂名稱與嬰兒車停放空間測試".repeat(3),
  branch_name: "隔離測試分店", payment_info: "隔離資料，不接受真實付款",
  line_pay_url: "https://pay.example.invalid/never-open", line_pay_dynamic_enabled: true,
  start_time: "2030-09-20T02:00:00Z", end_time: "2030-09-20T05:00:00Z",
  status: "confirmed", total_price: 2000, guest_count: 4, customer_name: "虛構測試客人",
  deposit_required: true, deposit_amount: 1000, is_deposit_paid: false,
  payment_review_status: "pending_review", created_at: "2030-09-10T02:00:00Z",
};

async function query(page: Page) {
  await page.getByPlaceholder("輸入訂位電話").fill("0912345678");
  await page.getByPlaceholder("訂位代號（6 碼）").fill("E2E001");
  await page.getByRole("button", { name: "查詢", exact: true }).click();
}

for (const width of [390, 1440]) {
  test.describe(`付款下一步 ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("後端待審→已收款；失敗重試與跨頁返回不重付", async ({ page }, testInfo) => {
      let response: Record<string, unknown> = { ...booking };
      let mode: "ok" | "error" | "empty" | "loading" = "ok";
      let release: (() => void) | undefined;
      let lookups = 0;
      const forbidden: string[] = [], errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", async route => {
        const url = new URL(route.request().url());
        const base = new URL(String(testInfo.project.use.baseURL));
        if (url.origin !== base.origin) return route.abort();
        if (!url.pathname.startsWith("/api/")) return route.continue();
        if (url.pathname === "/api/guest-events") return route.fulfill({ json: { ok: true } });
        if (url.pathname !== "/api/my-bookings") {
          forbidden.push(url.pathname);
          return route.abort();
        }
        lookups++;
        if (mode === "loading") await new Promise<void>(resolve => { release = resolve; });
        await route.fulfill({ status: mode === "error" ? 503 : 200,
          json: mode === "error" ? { error: "暫時無法查詢，請稍後重試" } : mode === "empty" ? [] : [response] });
      });
      await page.goto("/book/query");
      await query(page);
      await expect(page.getByText("已收到您的匯款回報，待店家核對後可回本頁查看付款狀態；若已綁定 LINE，系統也會自動通知您。不需要另外傳 LINE。")).toBeVisible();
      await expect(page.getByText(/1 小時內完成|將自動發送 LINE 確認/)).toHaveCount(0);
      await expect(page.getByText(/需繳納訂金以完成保留/)).toHaveCount(0);
      await expect(page.getByRole("button", { name: /LINE Pay 付款/ })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /加官方 LINE 回傳/ })).toHaveCount(0);
      await expect(page.getByText("已收到您的匯款回報，待店家核對後可回本頁查看付款狀態；若已綁定 LINE，系統也會自動通知您。不需要另外傳 LINE。")).toHaveCount(1);
      await expect(page.getByText(/訂金已確認|已確認收款/)).toHaveCount(0);
      await expect(page.locator("html")).toHaveJSProperty("scrollWidth", width);
      await page.screenshot({ path: testInfo.outputPath("pending.png"), fullPage: true });

      mode = "loading";
      const before = lookups;
      await page.getByRole("button", { name: "查詢", exact: true }).dblclick();
      await expect(page.getByRole("button", { name: "查詢中…", exact: true })).toBeDisabled();
      await expect.poll(() => lookups).toBe(before + 1);
      response = { ...booking, is_deposit_paid: true, payment_review_status: "approved",
        notification_status: "failed" };
      mode = "ok";
      release?.();
      await expect(page.getByText(/訂金已確認|已確認收款/).first()).toBeVisible();
      await expect(page.getByText(/需繳納訂金以完成保留/)).toHaveCount(0);
      await expect(page.getByRole("button", { name: /LINE Pay 付款/ })).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("paid-notification-failed.png"), fullPage: true });

      mode = "error";
      await page.getByRole("button", { name: "查詢", exact: true }).click();
      await expect(page.getByText("暫時無法查詢，請稍後重試")).toBeVisible();
      await expect(page.getByPlaceholder("輸入訂位電話")).toHaveValue("0912345678");
      await expect(page.getByPlaceholder("訂位代號（6 碼）")).toHaveValue("E2E001");
      await expect(page.getByText(/訂金已確認|已確認收款/)).toHaveCount(0);
      mode = "ok";
      await page.getByRole("button", { name: "查詢", exact: true }).click();
      await expect(page.getByText(/訂金已確認|已確認收款/).first()).toBeVisible();

      // A real navigation away and back, then a new authoritative lookup.
      await page.getByRole("link", { name: "返回", exact: true }).click();
      await expect(page).toHaveURL(/\/$/);
      await page.goBack();
      await expect(page).toHaveURL(/\/book\/query$/);
      response = { ...booking };
      await query(page);
      await expect(page.getByText("已收到您的匯款回報，待店家核對後可回本頁查看付款狀態；若已綁定 LINE，系統也會自動通知您。不需要另外傳 LINE。")).toBeVisible();
      await expect(page.getByText(/需繳納訂金以完成保留/)).toHaveCount(0);
      mode = "empty";
      await page.getByRole("button", { name: "查詢", exact: true }).click();
      await expect(page.getByText(/查無|沒有.*訂位|找不到.*訂位/).first()).toBeVisible();
      await expect(page.locator("html")).toHaveJSProperty("scrollWidth", width);
      expect(forbidden).toEqual([]);
      expect(errors).toEqual([]);
    });

    for (const state of ["approved-unpaid", "unknown", "rejected", "url-only"]) {
      test(`${state} 不誤報已收款或要求再付款`, async ({ page }) => {
        const item: Record<string, unknown> = { ...booking,
          payment_review_status: state === "approved-unpaid" ? "approved" : state === "rejected" ? "rejected" : null };
        if (state === "unknown") delete item.is_deposit_paid;
        await page.route("**/api/**", route => route.fulfill({ json:
          new URL(route.request().url()).pathname === "/api/my-bookings" ? [item] : { ok: true } }));
        await page.goto(state === "url-only" ? "/book/query?linepay=success" : "/book/query");
        // A return URL is not authoritative confirmation.
        await expect(page.getByText(/付款成功|已自動對應訂位|店家已收到付款通知/)).toHaveCount(0);
        await expect(page.getByText(/訂金已確認|已確認收款/)).toHaveCount(0);
        await query(page);
        await expect(page.getByText("E2E001", { exact: true })).toBeVisible();
        await expect(page.getByText(/訂金已確認|已確認收款/)).toHaveCount(0);
        if (state !== "url-only") {
          await expect(page.getByRole("button", { name: /LINE Pay 付款/ })).toHaveCount(0);
          await expect(page.getByText(/需繳納訂金以完成保留/)).toHaveCount(0);
        }
        await expect(page.locator("html")).toHaveJSProperty("scrollWidth", width);
      });
    }
  });
}
