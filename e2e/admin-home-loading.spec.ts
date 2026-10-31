import { expect, test, type Page } from "@playwright/test";
import { seedAdminSession } from "./helpers/admin-session";

const branches = [
  { id: "b1", name: "甲店", closed_dates: [] },
  { id: "b2", name: "乙店", closed_dates: [] },
];
const room = (branchId: string) => ({
  id: `${branchId}-room`, branch_id: branchId, name: `${branchId === "b1" ? "甲" : "乙"}包廂`,
  capacity: 4, price_weekday: 100, price_weekend: 120,
});

async function prepare(page: Page, role = "owner") {
  await seedAdminSession(page.context());
  await page.route("**/api/admin/me", (route) => role === "failed"
    ? route.fulfill({ status: 503, json: { error: "unavailable" } })
    : route.fulfill({ json: { role, branch_ids: null, permissions: {} } }));
  await page.route("**/api/reservations**", (route) => route.fulfill({ json: { items: [], nextCursor: null, total: 0, warnings: [] } }));
}

test("branch 503 and malformed data are distinct from empty and can be retried", async ({ page }) => {
  await prepare(page);
  let calls = 0;
  await page.route("**/api/branches?include=archived", (route) => {
    calls++;
    if (calls === 1) return route.fulfill({ status: 503, json: { error: "暫時無法取得分店" } });
    if (calls === 2) return route.fulfill({ json: { error: "not a branch list" } });
    return route.fulfill({ json: branches });
  });
  await page.route("**/api/settings", (route) => route.fulfill({ json: {} }));
  await page.goto("/admin");
  await expect(page.getByText(/分店載入失敗/)).toBeVisible();
  await expect(page.getByText("尚無分店，請新增。")).toHaveCount(0);
  await page.getByRole("button", { name: "重試載入分店" }).click();
  await expect(page.getByText(/分店資料格式不正確/)).toBeVisible();
  await page.getByRole("button", { name: "重試載入分店" }).click();
  await expect(page.getByRole("button", { name: "封存 甲店" })).toBeVisible();
  await expect(page.getByText(/分店載入失敗/)).toHaveCount(0);
});

test("a successful empty branch list is shown as empty instead of loading forever", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/branches?include=archived", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/settings", (route) => route.fulfill({ json: {} }));
  await page.goto("/admin");
  await expect(page.getByText("尚無分店，請新增。")).toBeVisible();
  await expect(page.getByText(/分店載入失敗/)).toHaveCount(0);
});

test("both reservation and management room requests recover from 503", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/branches?include=archived", (route) => route.fulfill({ json: branches }));
  await page.route("**/api/settings", (route) => route.fulfill({ json: { current_branch_id: "b1" } }));
  let roomCalls = 0;
  await page.route("**/api/rooms?**", (route) => {
    roomCalls++;
    if (roomCalls === 1 || roomCalls === 3) return route.fulfill({ status: 503, json: { error: "包廂暫時無法讀取" } });
    return route.fulfill({ json: [room("b1")] });
  });
  await page.goto("/admin");
  await expect(page.getByRole("button", { name: "重試訂位包廂" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新增訂位" })).toBeDisabled();
  await page.getByRole("button", { name: "重試訂位包廂" }).click();
  await expect(page.getByRole("button", { name: "新增訂位" })).toBeEnabled();
  await page.getByLabel("選擇要管理包廂的分店").selectOption("b1");
  await expect(page.getByRole("button", { name: "重試包廂" })).toBeVisible();
  await expect(page.getByText("此分店尚無包廂，請新增。")).toHaveCount(0);
  await page.getByRole("button", { name: "重試包廂" }).click();
  await expect(page.getByRole("button", { name: "編輯 甲包廂" })).toBeVisible();
});

test("late room and settings responses cannot override a newer branch selection", async ({ page }) => {
  await prepare(page, "staff");
  await page.route("**/api/branches?include=archived", (route) => route.fulfill({ json: branches }));
  let releaseOldRoom!: () => void;
  let oldRoomRequested!: () => void;
  let releaseSettings!: () => void;
  const oldRoomGate = new Promise<void>((resolve) => { releaseOldRoom = resolve; });
  const oldRoomArrived = new Promise<void>((resolve) => { oldRoomRequested = resolve; });
  const settingsGate = new Promise<void>((resolve) => { releaseSettings = resolve; });
  let patches = 0;
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "PATCH") { patches++; return route.fulfill({ json: {} }); }
    await settingsGate;
    return route.fulfill({ json: { current_branch_id: "b1", deposit_info: "設定已載入" } });
  });
  await page.route("**/api/rooms?**", async (route) => {
    const branchId = new URL(route.request().url()).searchParams.get("branchId")!;
    if (branchId === "b1") { oldRoomRequested(); await oldRoomGate; }
    return route.fulfill({ json: [room(branchId)] });
  });
  await page.goto("/admin");
  const manage = page.getByLabel("選擇要管理包廂的分店");
  await manage.selectOption("b1");
  await oldRoomArrived;
  await manage.selectOption("b2");
  await expect(page.getByRole("button", { name: "編輯 乙包廂" })).toBeVisible();
  const reservationBranch = page.getByLabel("選擇分店").first();
  await reservationBranch.selectOption("b2");
  await expect(page.getByRole("button", { name: "新增訂位" })).toBeEnabled();
  const oldRoomResponse = page.waitForResponse((response) => response.url().includes("/api/rooms?branchId=b1"));
  releaseOldRoom();
  await oldRoomResponse;
  releaseSettings();
  await expect(page.getByPlaceholder(/訂金請於確認後/)).toHaveValue("設定已載入");
  await expect(reservationBranch).toHaveValue("b2");
  await expect(page.getByRole("button", { name: "編輯 乙包廂" })).toBeVisible();
  await expect(page.getByRole("button", { name: "編輯 甲包廂" })).toHaveCount(0);
  expect(patches).toBe(0);
});

test("URL focus beats delayed saved settings", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/branches?include=archived", (route) => route.fulfill({ json: branches }));
  let releaseSettings!: () => void;
  const settingsGate = new Promise<void>((resolve) => { releaseSettings = resolve; });
  await page.route("**/api/settings", async (route) => { await settingsGate; return route.fulfill({ json: { current_branch_id: "b1", deposit_info: "設定已載入" } }); });
  await page.route("**/api/rooms?**", (route) => route.fulfill({ json: [room("b2")] }));
  await page.goto("/admin?branchId=b2");
  const reservationBranch = page.getByLabel("選擇分店").first();
  await expect(reservationBranch).toHaveValue("b2");
  const settingsResponse = page.waitForResponse((response) => response.url().endsWith("/api/settings"));
  releaseSettings();
  await settingsResponse;
  await expect(page.getByPlaceholder(/訂金請於確認後/)).toHaveValue("設定已載入");
  await expect(reservationBranch).toHaveValue("b2");
});

for (const role of ["owner", "staff", "unknown", "failed"]) {
  test(`${role} switches locally; only owner persists the shared branch`, async ({ page }) => {
    await prepare(page, role);
    await page.route("**/api/branches?include=archived", (route) => route.fulfill({ json: branches }));
    let patches = 0;
    await page.route("**/api/settings", (route) => {
      if (route.request().method() === "PATCH") { patches++; return route.fulfill({ json: {} }); }
      return route.fulfill({ json: {} });
    });
    await page.route("**/api/rooms?**", (route) => {
      const id = new URL(route.request().url()).searchParams.get("branchId")!;
      return route.fulfill({ json: [room(id)] });
    });
    const me = page.waitForResponse((response) => response.url().endsWith("/api/admin/me"));
    await page.goto("/admin");
    await me;
    const select = page.getByLabel("選擇分店").first();
    await select.selectOption("b2");
    await expect(select).toHaveValue("b2");
    await expect(page.getByRole("button", { name: "新增訂位" })).toBeEnabled();
    if (role === "owner") await expect.poll(() => patches).toBe(1);
    else expect(patches).toBe(0);
    if (role === "unknown" || role === "failed") {
      await expect(page.getByText(/無法確認身分，切換分店只影響目前畫面/)).toBeVisible();
    }
  });
}

test("owner branch selection made while role is loading is saved only after owner is confirmed", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/branches?include=archived", (route) => route.fulfill({ json: branches }));
  let releaseRole!: () => void;
  const roleGate = new Promise<void>((resolve) => { releaseRole = resolve; });
  await page.route("**/api/admin/me", async (route) => { await roleGate; return route.fulfill({ json: { role: "owner" } }); });
  const patches: unknown[] = [];
  await page.route("**/api/settings", (route) => {
    if (route.request().method() === "PATCH") { patches.push(route.request().postDataJSON()); return route.fulfill({ json: {} }); }
    return route.fulfill({ json: {} });
  });
  await page.route("**/api/rooms?**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("branchId")!;
    return route.fulfill({ json: [room(id)] });
  });
  await page.goto("/admin");
  await page.getByLabel("選擇分店").first().selectOption("b2");
  await expect(page.getByRole("button", { name: "新增訂位" })).toBeEnabled();
  expect(patches).toHaveLength(0);
  releaseRole();
  await expect.poll(() => patches).toEqual([{ current_branch_id: "b2" }]);
});

test("owner branch changes are serialized and persist the latest selection", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/branches?include=archived", (route) => route.fulfill({ json: branches }));
  await page.route("**/api/rooms?**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("branchId")!;
    return route.fulfill({ json: [room(id)] });
  });
  const writes: Array<string | null> = [];
  let releaseFirst!: () => void;
  let notifyFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const firstArrived = new Promise<void>((resolve) => { notifyFirst = resolve; });
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() !== "PATCH") return route.fulfill({ json: {} });
    writes.push(route.request().postDataJSON().current_branch_id);
    if (writes.length === 1) { notifyFirst(); await firstGate; }
    return route.fulfill({ json: {} });
  });
  const me = page.waitForResponse((response) => response.url().endsWith("/api/admin/me"));
  await page.goto("/admin");
  await me;
  const select = page.getByLabel("選擇分店").first();
  await select.selectOption("b1");
  await firstArrived;
  await select.selectOption("b2");
  await expect(select).toHaveValue("b2");
  expect(writes).toEqual(["b1"]);
  releaseFirst();
  await expect.poll(() => writes).toEqual(["b1", "b2"]);
});

test("failed settings write warns and requires an explicit retry of the latest selection", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/branches?include=archived", (route) => route.fulfill({ json: branches }));
  await page.route("**/api/rooms?**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("branchId")!;
    return route.fulfill({ json: [room(id)] });
  });
  const writes: Array<string | null> = [];
  let releaseFirst!: () => void;
  let notifyFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const firstArrived = new Promise<void>((resolve) => { notifyFirst = resolve; });
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() !== "PATCH") return route.fulfill({ json: {} });
    writes.push(route.request().postDataJSON().current_branch_id);
    if (writes.length === 1) { notifyFirst(); await firstGate; return route.fulfill({ status: 503, json: { error: "無法儲存" } }); }
    return route.fulfill({ json: {} });
  });
  await page.goto("/admin");
  const select = page.getByLabel("選擇分店").first();
  await select.selectOption("b1");
  await firstArrived;
  await select.selectOption("b2");
  releaseFirst();
  await expect(page.getByText(/無法確認全站預設分店已儲存/)).toBeVisible();
  expect(writes).toEqual(["b1"]);
  await page.getByRole("button", { name: "手動重試儲存預設分店" }).click();
  await expect.poll(() => writes).toEqual(["b1", "b2"]);
  await expect(page.getByText(/無法確認全站預設分店已儲存/)).toHaveCount(0);
  await expect(select).toHaveValue("b2");
});

test("a failed identity lookup warns and can be retried without treating the user as owner", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/branches?include=archived", (route) => route.fulfill({ json: branches }));
  await page.route("**/api/rooms?**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("branchId")!;
    return route.fulfill({ json: [room(id)] });
  });
  let identityCalls = 0;
  await page.route("**/api/admin/me", (route) => {
    identityCalls++;
    return identityCalls === 1 ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: { role: "owner" } });
  });
  const writes: Array<string | null> = [];
  await page.route("**/api/settings", (route) => {
    if (route.request().method() === "PATCH") writes.push(route.request().postDataJSON().current_branch_id);
    return route.fulfill({ json: {} });
  });
  await page.goto("/admin");
  await expect(page.getByText(/無法確認身分，切換分店只影響目前畫面/)).toBeVisible();
  const select = page.getByLabel("選擇分店").first();
  await select.selectOption("b2");
  await expect(page.getByRole("button", { name: "新增訂位" })).toBeEnabled();
  expect(writes).toEqual([]);
  await page.getByRole("button", { name: "重試確認身分" }).click();
  await expect.poll(() => writes).toEqual(["b2"]);
  await expect(page.getByText(/無法確認身分，切換分店只影響目前畫面/)).toHaveCount(0);
});
