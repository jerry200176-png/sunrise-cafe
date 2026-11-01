import { expect, test } from "@playwright/test";

const id = "00000000-0000-4000-8000-000000000001";
const itemA = "00000000-0000-4000-8000-000000000002";
const itemB = "00000000-0000-4000-8000-000000000003";
const token = "synthetic-guest-token";
const row = (menu_item_id: string) => ({ menu_item_id, quantity: 1, option_ids: [], special_notes: "" });
const pageData = { reservation: { customer_name: "合成客人", start_time: "2099-01-01T10:00:00+08:00" }, menu: [
  { id: itemA, name: "咖啡", price: 100, options: [] },
  { id: itemB, name: "茶", price: 80, options: [] },
], preorder: null, editable: true };
const url = `/book/preorder?id=${id}&token=${token}`;

test("回應中斷後同分頁不重送，重新整理仍提供查詢", async ({ page }) => {
  let posts = 0;
  await page.route("**/api/reservation-preorders/**", (route) => {
    if (route.request().method() === "POST") { posts += 1; return route.abort("failed"); }
    return route.fulfill({ json: pageData });
  });
  await page.goto(url);
  await page.getByLabel("選擇咖啡").check();
  const submit = page.getByRole("button", { name: "確認送出預製餐點" });
  await submit.click();
  const alert = page.getByRole("alert").filter({ hasText: "結果尚未確認" });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole("link", { name: "前往訂位管理" })).toHaveAttribute("href", "/book/query");
  await expect(submit).toBeDisabled();
  const saved = await page.evaluate(() => JSON.stringify({ ...sessionStorage }));
  expect(saved).not.toContain(token);
  expect(saved).not.toContain("咖啡");
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "結果尚未確認" })).toBeVisible();
  await expect(submit).toBeDisabled();
  expect(posts).toBe(1);
});

test("已存在預點且沒有 RPC result 時不假稱新選擇已套用", async ({ page }) => {
  await page.route("**/api/reservation-preorders/**", (route) => route.request().method() === "POST"
    ? route.fulfill({ json: { ok: true, preorder: { status: "submitted", draft_items: [row(itemB)], guest_notes: "先前備註" } } })
    : route.fulfill({ json: pageData }));
  await page.goto(url);
  await page.getByLabel("選擇咖啡").check();
  await page.getByRole("button", { name: "確認送出預製餐點" }).click();
  await expect(page.getByRole("status")).toContainText("新選擇未必已套用");
  await expect(page.getByLabel("選擇咖啡")).not.toBeChecked();
  await expect(page.getByLabel("選擇茶")).toBeChecked();
  await expect(page.getByPlaceholder(/整體備註/)).toHaveValue("先前備註");
  await expect(page.getByText(/NT\$/)).toHaveCount(0);
});

test("送出收到標頭但本文停滯，逾時後保留待確認保護", async ({ page }) => {
  await page.route("**/api/reservation-preorders/**", (route) => route.fulfill({ json: pageData }));
  await page.goto(url);
  await page.getByLabel("選擇咖啡").check();
  await page.evaluate(() => {
    const state = window as typeof window & { preorderPosts: number; bodyCancelled: boolean };
    state.preorderPosts = 0; state.bodyCancelled = false;
    const originalFetch = window.fetch.bind(window);
    const originalTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
      originalTimeout(handler, delay === 15000 ? 40 : delay, ...args)) as typeof window.setTimeout;
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes("/api/reservation-preorders/") || init?.method !== "POST") return originalFetch(input, init);
      state.preorderPosts += 1;
      const body = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":')); },
        cancel() { state.bodyCancelled = true; },
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/json" } }));
    }) as typeof window.fetch;
  });
  const submit = page.getByRole("button", { name: "確認送出預製餐點" });
  await submit.click();
  await expect(page.getByRole("alert").filter({ hasText: "結果尚未確認" })).toBeVisible();
  await expect(submit).toBeDisabled();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { bodyCancelled: boolean }).bodyCancelled)).toBe(true);
  expect(await page.evaluate(() => (window as typeof window & { preorderPosts: number }).preorderPosts)).toBe(1);
});


test("A→B→A 時舊提交和較晚讀取不覆蓋待確認狀態", async ({ page }) => {
  const idB = "00000000-0000-4000-8000-000000000009";
  let releasePost: () => void = () => {};
  let releaseRead: () => void = () => {};
  let posts = 0;
  let readsA = 0;
  const oldPost = new Promise<void>((resolve) => { releasePost = resolve; });
  const lateRead = new Promise<void>((resolve) => { releaseRead = resolve; });
  await page.route("**/api/reservation-preorders/**", async (route) => {
    if (route.request().method() === "POST") {
      posts += 1;
      await oldPost;
      return route.fulfill({ json: { ok: true, preorder: { status: "submitted", draft_items: [row(itemA)], result: { already_submitted: false } } } });
    }
    if (route.request().url().includes(idB)) return route.fulfill({ json: { ...pageData, reservation: { ...pageData.reservation, customer_name: "另一筆" } } });
    readsA += 1;
    if (readsA > 1) await lateRead;
    return route.fulfill({ json: pageData });
  });
  await page.goto(url);
  await page.getByLabel("選擇咖啡").check();
  await page.getByRole("button", { name: "確認送出預製餐點" }).click();
  await expect.poll(() => posts).toBe(1);
  await page.evaluate(({ next }) => window.history.pushState({}, "", next), { next: `/book/preorder?id=${idB}&token=other-synthetic-token` });
  await expect(page.getByText(/另一筆/)).toBeVisible();
  await page.evaluate(({ next }) => window.history.pushState({}, "", next), { next: url });
  await expect.poll(() => readsA).toBe(2);
  releasePost();
  await expect(page.getByRole("alert").filter({ hasText: "結果尚未確認" })).toBeVisible();
  releaseRead();
  await expect(page.getByLabel("選擇咖啡")).toBeVisible();
  await expect(page.getByRole("button", { name: "確認送出預製餐點" })).toBeDisabled();
  await expect(page.getByText("已送出提前預製餐點，店家將依訂位準備。需要變更請聯絡店家。")).toHaveCount(0);
  expect(posts).toBe(1);
});
