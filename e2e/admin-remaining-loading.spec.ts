import { test, expect } from "@playwright/test";
import { seedAdminSession } from "./helpers/admin-session";

test("付款頁的 migration-status HTTP 錯誤會顯示為載入錯誤，不會說成尚未開通", async ({ page, context }) => {
  await seedAdminSession(context);
  await page.route("**/api/admin/payments/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/admin/payments/migration-status", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) })
  );

  await page.goto("/admin/payments");
  await expect(page.getByRole("alert")).toContainText("系統暫時有問題");
  await expect(page.getByText("付款審核功能尚未開通")).toHaveCount(0);
});

test("使用者頁 API 非 2xx 會顯示錯誤，而不是空使用者清單", async ({ page, context }) => {
  await seedAdminSession(context);
  await page.route("**/api/admin/me", (route) => route.fulfill({ json: { role: "owner", permissions: { users_manage: true } } }));
  await page.route("**/api/admin/users", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) })
  );

  await page.goto("/admin/users");
  await expect(page.getByText("系統暫時有問題")).toBeVisible();
  await expect(page.getByText("尚無 RBAC 使用者", { exact: false })).toHaveCount(0);
});

test("包廂場控讀到錯誤格式會顯示錯誤，不會當成空包廂", async ({ page, context }) => {
  await seedAdminSession(context);
  await page.addInitScript(() => window.localStorage.setItem("sunrise.floor.view", "list"));
  await page.route("**/api/branches", (route) => route.fulfill({ json: [{ id: "b1", name: "測試店" }] }));
  await page.route("**/api/admin/me", (route) => route.fulfill({ json: { branch_ids: ["b1"] } }));
  await page.route("**/api/admin/floor?**", (route) => route.fulfill({ json: { rooms: "not-an-array" } }));

  await page.goto("/admin/floor");
  await expect(page.getByRole("alert")).toContainText("包廂資料格式錯誤");
  await expect(page.getByText("此分店尚未建立包廂")).toHaveCount(0);
});

test("等位頁 HTTP 錯誤不會顯示成空清單", async ({ page, context }) => {
  await seedAdminSession(context);
  await page.route("**/api/admin/waitlist", (route) => route.fulfill({ status: 503, body: "upstream unavailable" }));

  await page.goto("/admin/waitlist");
  await expect(page.getByRole("alert")).toContainText("系統暫時有問題");
  await expect(page.getByText("目前無等位紀錄")).toHaveCount(0);
});

test("等位頁格式錯誤會顯示明確錯誤", async ({ page, context }) => {
  await seedAdminSession(context);
  await page.route("**/api/admin/waitlist", (route) => route.fulfill({ json: { items: {}, needs_call_count: "bad" } }));

  await page.goto("/admin/waitlist");
  await expect(page.getByRole("alert")).toContainText("等位清單資料格式錯誤");
  await expect(page.getByText("目前無等位紀錄")).toHaveCount(0);
});

test("LINE 帳號頁 HTTP 與格式錯誤都會離開 loading 並顯示錯誤", async ({ page, context }) => {
  await seedAdminSession(context);
  let calls = 0;
  await page.route("**/api/admin/line-accounts", (route) => {
    calls++;
    return calls === 1
      ? route.fulfill({ status: 503, body: "upstream unavailable" })
      : route.fulfill({ json: { fetchedAt: "2026-10-31", accounts: {}, collisions: [], identityComplete: true } });
  });

  await page.goto("/admin/line-accounts");
  await expect(page.getByRole("alert")).toContainText("系統暫時有問題");
  await page.getByRole("button", { name: "重試" }).click();
  await expect(page.getByRole("alert")).toContainText("LINE 帳號資料格式錯誤");
  await expect(page.getByText("讀取中…")).toHaveCount(0);
});

test("訂位餐點頁的讀取錯誤會結束載入並顯示 API 錯誤", async ({ page, context }) => {
  await seedAdminSession(context);
  await page.route("**/api/admin/reservation-orders/res-1", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not found" }) })
  );

  await page.goto("/admin/reservation-orders/res-1");
  await expect(page.getByRole("alert")).toContainText("找不到這筆資料");
  await expect(page.getByText("載入中…")).toHaveCount(0);
});

test("訂位餐點頁切換 id 後，較早的 GET 回覆不會覆蓋目前訂位", async ({ page, context }) => {
  await seedAdminSession(context);
  let releaseOld!: () => void;
  const oldResponse = new Promise<void>((resolve) => { releaseOld = resolve; });
  let oldStarted = false;
  await page.route("**/api/admin/reservation-orders/**", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    if (route.request().method() !== "GET") return route.fulfill({ json: { ok: true } });
    if (id === "res-1") {
      oldStarted = true;
      await oldResponse;
      return route.fulfill({ json: { reservation: { customer_name: "舊訂位", booking_code: "OLD", start_time: "2026-10-15T06:00:00Z", status: "checked_in", room: null }, preorder: null, order: null } });
    }
    return route.fulfill({ json: { reservation: { customer_name: "新訂位", booking_code: "NEW", start_time: "2026-10-16T06:00:00Z", status: "checked_in", room: null }, preorder: null, order: null } });
  });

  await page.goto("/admin/reservation-orders/res-1");
  await expect.poll(() => oldStarted).toBe(true);
  await page.evaluate(() => window.history.pushState(null, "", "/admin/reservation-orders/res-2"));
  await expect(page).toHaveURL(/res-2$/);
  await expect(page.getByText(/新訂位.*NEW/)).toBeVisible();
  releaseOld();
  await expect(page.getByText(/新訂位.*NEW/)).toBeVisible();
  await expect(page.getByText(/舊訂位|OLD/)).toHaveCount(0);
});

test("菜單失敗不遮住訂位資料，也不把成功 mutation 說成失敗或重送", async ({ page, context }) => {
  await seedAdminSession(context);
  const view = { reservation: { customer_name: "測試客人", booking_code: "MENU1", start_time: "2026-10-15T06:00:00Z", status: "checked_in", room: { name: "A", branch_id: "b1" } }, preorder: null, order: null };
  let posts = 0;
  await page.route("**/api/admin/reservation-orders/res-1", async (route) => {
    if (route.request().method() === "POST") {
      posts++;
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({ json: view });
  });
  await page.route("**/api/menu?branchId=b1", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }));

  await page.goto("/admin/reservation-orders/res-1");
  await expect(page.getByText(/測試客人.*MENU1/)).toBeVisible();
  await expect(page.getByRole("status")).toContainText("餐點選單暫時無法載入");
  await page.getByRole("button", { name: "確認客人到店，送入備餐清單" }).dblclick();
  await expect.poll(() => posts).toBe(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(posts).toBe(1);
});

test("付款審核 refresh 中核准後，舊 GET 不會把已處理付款加回清單", async ({ page, context }) => {
  await seedAdminSession(context);
  const pending = { id: "p1", reservation_id: "r1", booking_code: "AB12", customer_name: "王小明", phone: "0912345678", start_time: "2026-10-09T10:00:00Z", deposit_amount: 500, reservation_status: "pending", created_at: "2026-10-08T01:00:00Z", raw_payload: null, source: "line_text", is_deposit_paid: false, reported_account_last_five: null, reported_amount: null, reported_at: null };
  let pendingCalls = 0;
  let approveCalls = 0;
  let releaseOld!: () => void;
  const oldResponse = new Promise<void>((resolve) => { releaseOld = resolve; });
  let oldStarted = false;
  await page.route("**/api/admin/payments/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/migration-status")) return route.fulfill({ json: { payment_events_ready: true } });
    if (path.endsWith("/pending")) {
      pendingCalls++;
      if (pendingCalls === 2) { oldStarted = true; await oldResponse; }
      return route.fulfill({ json: [pending] });
    }
    if (path.endsWith("/reconcile")) return route.fulfill({ json: { items: [] } });
    if (path.endsWith("/approve")) { approveCalls++; return route.fulfill({ json: { ok: true, notification: null } }); }
    return route.fulfill({ json: {} });
  });

  await page.goto("/admin/payments");
  await expect(page.getByText("王小明")).toBeVisible();
  await page.getByRole("button", { name: "確認已收款" }).click();
  await page.getByRole("button", { name: "重新整理" }).click();
  await expect.poll(() => oldStarted).toBe(true);
  await page.getByRole("dialog").getByRole("button", { name: "確認已收款" }).click();
  await expect(page.getByText("已確認收款")).toBeVisible();
  releaseOld();
  await expect(page.getByText("代號 AB12 · 0912345678")).toHaveCount(0);
  expect(approveCalls).toBe(1);
});

test("付款風險 refresh 失敗時清除舊風險並明確顯示錯誤", async ({ page, context }) => {
  await seedAdminSession(context);
  let reconcileCalls = 0;
  await page.route("**/api/admin/payments/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/migration-status")) return route.fulfill({ json: { payment_events_ready: true } });
    if (path.endsWith("/pending")) return route.fulfill({ json: [] });
    if (path.endsWith("/reconcile")) {
      reconcileCalls++;
      if (reconcileCalls > 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) });
      return route.fulfill({ json: { items: [{ booking_code: "ZZ55", customer_name: "風險客人", status: "pending", deadline: "2026-10-31T10:00:00Z", would_auto_release: false }] } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto("/admin/payments");
  await expect(page.getByText("風險客人")).toBeVisible();
  await page.getByRole("button", { name: "重新整理" }).click();
  await expect(page.getByRole("alert")).toContainText("風險資料無法更新");
  await expect(page.getByText("風險客人")).toHaveCount(0);
});

test("系統狀態主資料先顯示，次要 API 尚未回應不會卡住整頁", async ({ page, context }) => {
  await seedAdminSession(context);
  const outcome = {
    collected_at: "2026-10-31T00:00:00Z", status: "ok",
    health_block: { date: "2026-10-31", deposit_rate_pct: 60, waitlist_conversion_pct: null, payment_review_oldest_hours: null, migrations_all_applied: "yes", overlap_constraint_active: "yes" },
    booking: { bookings_30d: 1, bookings_7d: 1, cancellation_rate_30d: null, cancellation_count_30d: 0 },
    payment: { deposit_rate_pct: 60, pending_reviews: 0, payment_review_oldest_hours: null, deposit_at_risk: 0, payment_events_ready: true },
    cancellation: { cancelled_30d: 0, auto_release_proxy_7d: 0 },
    waitlist: { joined_30d: 0, converted_30d: 0, conversion_pct: null },
    cron: { deposit_reminders_7d: 0, tomorrow_reminders_pending: 0, auto_releases_7d: 0, job_runs_ready: true, jobs: [] },
    deployment: { commit: null, live_commit_short: null, repository_commit: null, sha_parity: null, production_reachable: true, health_ok: true },
    migrations: { all_required_applied: true, pending: [], overlap_constraint_active: true, closed_dates_column: true },
    support: { pending_payment_reviews: 0, rejected_events_7d: 0 },
    funnel: { ops_events_ready: false, booking_flow_entered_7d: 0, booking_created_7d: 0, booking_conversion_pct: null, deposit_instructions_viewed_7d: 0, payment_clicks_7d: 0, payment_completion_pct: null, payment_approved_7d: 0, payment_approved_keyboard_7d: 0, keyboard_adoption_pct: null },
  };
  let releaseOldSecondaries!: () => void;
  const oldSecondaryGate = new Promise<void>((resolve) => { releaseOldSecondaries = resolve; });
  let secondaryRequests = 0;
  let northStarCalls = 0;
  let orchestratorCalls = 0;
  let outcomeRequests = 0;
  await page.route("**/api/admin/outcomes", (route) => {
    outcomeRequests++;
    return route.fulfill({ json: { ...outcome, payment: { ...outcome.payment, deposit_rate_pct: outcomeRequests === 1 ? 60 : 70 } } });
  });
  await page.route("**/api/admin/north-star", async (route) => {
    secondaryRequests++;
    northStarCalls++;
    if (northStarCalls === 1) await oldSecondaryGate;
    if (northStarCalls === 3) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) });
    await route.fulfill({ json: { measured_count: 1, unmeasured_count: 0, metrics: [{ id: "refresh", name: "refreshMetric", observed: northStarCalls === 1 ? 11 : 22, value: null, unit: "%", target: 50, delta: -28, status: "off_track" }] } });
  });
  await page.route("**/api/admin/orchestrator", async (route) => {
    secondaryRequests++;
    orchestratorCalls++;
    if (orchestratorCalls === 1) await oldSecondaryGate;
    if (orchestratorCalls === 3) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) });
    await route.fulfill({ json: { status: "ok", iteration_count: 0, operational_mode: "", gate_block: false, next_task: null, ranked_executable: [], stall: { stalled: false, warnings: [] }, recent_learnings: [] } });
  });

  await page.goto("/admin/system");
  await expect(page.getByText(/60% \(目標 85%\)/).first()).toBeVisible();
  await expect.poll(() => secondaryRequests).toBe(2);
  await page.getByRole("button", { name: "重新整理" }).click();
  await expect(page.getByText(/70% \(目標 85%\)/).first()).toBeVisible();
  await expect.poll(() => secondaryRequests).toBe(4);
  await expect(page.getByText("22%", { exact: true })).toBeVisible();
  releaseOldSecondaries();
  await expect(page.getByText("22%", { exact: true })).toBeVisible();
  await expect(page.getByText("11%", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "重新整理" }).click();
  await expect.poll(() => outcomeRequests).toBe(3);
  await expect(page.getByRole("status")).toContainText("部分系統狀態資料暫時無法取得");
  await expect(page.getByText("refreshMetric")).toHaveCount(0);
});
