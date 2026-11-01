// @vitest-environment jsdom
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "./dashboard/page";
import ExecutivePage from "./executive/page";
import ReportsPage from "./reports/page";
import { buildReport } from "@/lib/report-builder";

const mocked = vi.hoisted(() => ({
  branchState: {
    branches: [{ id: "b1", name: "甲店" }, { id: "b2", name: "乙店" }],
    loading: false, error: null as string | null, retry: vi.fn(),
  },
  fetch: vi.fn(),
}));
vi.mock("@/lib/use-admin-branches", () => ({ useAdminBranches: () => mocked.branchState }));
vi.mock("@/lib/fetch-with-timeout", () => ({
  fetchWithTimeout: mocked.fetch,
  readJsonWithTimeout: (response: Response) => response.json(),
}));
vi.mock("@/components/admin/AdminShell", () => ({ AdminShell: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => <main>{actions}{children}</main> }));
vi.mock("@/components/admin/AdvicePanel", async () => {
  const React = await import("react");
  return { AdvicePanel: ({ branchId }: { branchId: string }) => {
    // Keep the initially loaded scope, as the real async component does until remounted/refetched.
    const [loadedFor] = React.useState(branchId);
    return <div>ADVICE:{loadedFor}</div>;
  } };
});
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("recharts", () => ({
  BarChart: () => null, Bar: () => null, XAxis: () => null, YAxis: () => null,
  CartesianGrid: () => null, Tooltip: () => null, Legend: () => null,
  ResponsiveContainer: () => null,
}));

function json(data: unknown) { return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } }); }
function never(): Promise<Response> { return new Promise(() => {}); }
const overview = (n: number) => {
  const part = { label: "本月", received_deposits: n, received_orders: 5, expected_upcoming: 6, unpaid_deposits: 7, bookings: 1, guests: 2, cancelled: 0, deposit_paid_count: 1, deposit_rate: 1 };
  return { this_month: part, last_month: { ...part, label: "上月" } };
};
const report = (n: number) => ({
  summary: { received_deposits: n, received_orders: 5, expected_upcoming: 6, unpaid_deposits: 7, bookings: 1, cancellation_count: 0, cancellation_rate: 0, deposit_paid_count: 1, deposit_rate: 1 },
  monthly: [], by_room: [], by_hour: [],
});
const dashboard = (name: string, n: number) => ({
  stats: { todayCount: n, todayRevenue: n, roomsInUseCount: 1, totalRooms: 1 },
  timeline: { date: "2026-10-31", branchName: name, openTime: "09:00", closeTime: "21:00", rooms: [] },
  trend: { points: [] },
});

beforeEach(() => {
  mocked.branchState.branches = [{ id: "b1", name: "甲店" }, { id: "b2", name: "乙店" }];
  mocked.branchState.loading = false;
  mocked.branchState.error = null;
  mocked.fetch.mockReset();
});

describe("analytics branch scope shrinks", () => {
  it("dashboard discards removed branch metrics and reminder details before fallback data loads", async () => {
    let holdFallback = false;
    mocked.fetch.mockImplementation(async (input: string) => {
      if (input.startsWith("/api/admin/reminders")) return json([{ id: "r1", branch_name: "乙店", room_name: "乙房", customer_name: "僅乙店客人", phone: "0911000000", start_time: "2026-11-01T02:00:00Z", end_time: "2026-11-01T03:00:00Z", status: "confirmed", is_notified: false }]);
      const branch = new URL(input, "http://localhost").searchParams.get("branchId");
      if (branch === "b1" && holdFallback) return never();
      return json(dashboard(branch === "b2" ? "乙店" : "甲店", branch === "b2" ? 92 : 33));
    });
    const view = render(<DashboardPage />);
    await waitFor(() => expect((screen.getByLabelText("分店") as HTMLSelectElement).value).toBe("b1"));
    fireEvent.change(screen.getByLabelText("分店"), { target: { value: "b2" } });
    expect(await screen.findByText(/時間軸 · 乙店/)).toBeTruthy();
    expect(await screen.findByText(/僅乙店客人/)).toBeTruthy();
    holdFallback = true;
    mocked.branchState.branches = [{ id: "b1", name: "甲店" }];
    view.rerender(<DashboardPage />);
    expect(screen.queryByText(/時間軸 · 乙店/)).toBeNull();
    expect(screen.queryByText(/僅乙店客人/)).toBeNull();
    expect((screen.getByLabelText("分店") as HTMLSelectElement).value).toBe("b1");
  });

  it("executive discards removed branch numbers and advice while returning to all permitted branches", async () => {
    let holdFallback = false;
    mocked.fetch.mockImplementation(async (input: string) => {
      const branch = new URL(input, "http://localhost").searchParams.get("branchId");
      if (!branch && holdFallback) return never();
      return json(overview(branch === "b2" ? 9876 : 1234));
    });
    const view = render(<ExecutivePage />);
    await screen.findAllByText("NT$1,234");
    fireEvent.change(screen.getByLabelText("分店"), { target: { value: "b2" } });
    expect((await screen.findAllByText("NT$9,876")).length).toBeGreaterThan(0);
    expect(screen.getByText("ADVICE:b2")).toBeTruthy();
    holdFallback = true;
    mocked.branchState.branches = [{ id: "b1", name: "甲店" }];
    view.rerender(<ExecutivePage />);
    expect(screen.queryByText("NT$9,876")).toBeNull();
    expect(screen.queryByText("ADVICE:b2")).toBeNull();
    expect((screen.getByLabelText("分店") as HTMLSelectElement).value).toBe("");
    expect(screen.getByText("ADVICE:")).toBeTruthy();
  });

  it("reports hide and cannot export removed branch data while the scoped aggregate reloads", async () => {
    let holdFallback = false;
    mocked.fetch.mockImplementation(async (input: string) => {
      const branch = new URL(input, "http://localhost").searchParams.get("branchId");
      if (!branch && holdFallback) return never();
      return json(report(branch === "b2" ? 9876 : 1234));
    });
    const view = render(<ReportsPage />);
    expect(await screen.findByText("$1,234")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("分店"), { target: { value: "b2" } });
    expect(await screen.findByText("$9,876")).toBeTruthy();
    expect(screen.getByRole("button", { name: /匯出/ })).toBeTruthy();
    holdFallback = true;
    mocked.branchState.branches = [{ id: "b1", name: "甲店" }];
    view.rerender(<ReportsPage />);
    expect(screen.queryByText("$9,876")).toBeNull();
    expect(screen.queryByRole("button", { name: /匯出/ })).toBeNull();
    expect((screen.getByLabelText("分店") as HTMLSelectElement).value).toBe("");
  });

  it("all-branch overview and advice reload when the permitted branch set changes", async () => {
    let holdReload = false;
    mocked.fetch.mockImplementation(async () => holdReload ? never() : json(overview(9876)));
    const view = render(<ExecutivePage />);
    expect((await screen.findAllByText("NT$9,876")).length).toBeGreaterThan(0);
    holdReload = true;
    mocked.branchState.branches = [{ id: "b1", name: "甲店" }];
    view.rerender(<ExecutivePage />);
    expect(screen.queryByText("NT$9,876")).toBeNull();
    expect((screen.getByLabelText("分店") as HTMLSelectElement).value).toBe("");
    expect(screen.getByText("ADVICE:")).toBeTruthy();
  });

  it("all-branch report cannot export old aggregate after the permitted set changes", async () => {
    let holdReload = false;
    mocked.fetch.mockImplementation(async () => holdReload ? never() : json(report(9876)));
    const view = render(<ReportsPage />);
    expect(await screen.findByText("$9,876")).toBeTruthy();
    expect(screen.getByRole("button", { name: /匯出/ })).toBeTruthy();
    holdReload = true;
    mocked.branchState.branches = [{ id: "b1", name: "甲店" }];
    view.rerender(<ReportsPage />);
    expect(screen.queryByText("$9,876")).toBeNull();
    expect(screen.queryByRole("button", { name: /匯出/ })).toBeNull();
    expect((screen.getByLabelText("分店") as HTMLSelectElement).value).toBe("");
  });

  it("dashboard hides old reminders if the permitted branch set becomes empty", async () => {
    let holdReload = false;
    mocked.fetch.mockImplementation(async (input: string) => {
      if (input.startsWith("/api/admin/reminders")) {
        if (holdReload) return never();
        return json([{ id: "r1", branch_name: "甲店", room_name: "甲房", customer_name: "僅甲店客人", phone: "0911000000", start_time: "2026-11-01T02:00:00Z", end_time: "2026-11-01T03:00:00Z", status: "confirmed", is_notified: false }]);
      }
      return json(dashboard("甲店", 33));
    });
    const view = render(<DashboardPage />);
    expect(await screen.findByText(/僅甲店客人/)).toBeTruthy();
    holdReload = true;
    mocked.branchState.branches = [];
    view.rerender(<DashboardPage />);
    expect(screen.queryByText(/僅甲店客人/)).toBeNull();
    expect((screen.getByLabelText("分店") as HTMLSelectElement).value).toBe("");
    expect(screen.getByText("目前沒有可管理的分店。")).toBeTruthy();
  });
});

describe("report response errors", () => {
  it.each([null, {}, { ...report(1), by_hour: [{ hour: 8 }] }, { ...report(1), summary: { ...report(1).summary, received_deposits: null } }])(
    "rejects malformed report data and retries without exporting invalid data",
    async (invalid) => {
      mocked.fetch.mockResolvedValueOnce(json(invalid)).mockResolvedValueOnce(json(report(1234)));
      render(<ReportsPage />);
      expect((await screen.findByRole("alert")).textContent).toContain("報表資料格式錯誤");
      expect(screen.queryByRole("button", { name: /匯出/ })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "重試載入報表" }));
      expect(await screen.findByText("$1,234")).toBeTruthy();
      expect(screen.getByRole("button", { name: /匯出/ })).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("allows a valid report with empty collections and no deposit rate", async () => {
    const empty = buildReport([], [], 3, new Date("2026-11-01T00:00:00Z"), false);
    expect(empty.summary.deposit_rate).toBeNull();
    mocked.fetch.mockResolvedValue(json(empty));
    render(<ReportsPage />);
    expect(await screen.findByText("無資料")).toBeTruthy();
    expect(screen.getByRole("button", { name: /匯出/ })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
