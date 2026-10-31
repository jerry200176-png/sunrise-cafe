// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReservationList } from "./ReservationList";

const base = {
  room_id: "room-1",
  phone: "0900",
  email: null,
  guest_count: 2,
  total_price: 600,
  is_deposit_paid: true,
  notes: null,
  created_at: "2026-10-01T00:00:00Z",
  end_time: "2026-10-20T08:00:00Z",
};
const row = (id: string, status: string, start: string, extra: object = {}) => ({
  ...base,
  id,
  booking_code: id.toUpperCase(),
  customer_name: `客${id}`,
  status,
  start_time: start,
  ...extra,
});

type Body = { items: unknown[]; nextCursor?: string | null; total?: number | null; warnings?: string[] };

function mockApi(handler: (params: URLSearchParams) => Body) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      const body = url.startsWith("/api/reservations?")
        ? handler(new URL(url, "http://localhost").searchParams)
        : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    })
  );
  const listCalls = () =>
    urls.filter((u) => u.startsWith("/api/reservations?")).map((u) => new URL(u, "http://localhost").searchParams);
  return { listCalls };
}

const renderList = (props: { focusReservationId?: string } = {}) =>
  render(<ReservationList branchId="b1" rooms={[{ id: "room-1", name: "A 包廂" } as never]} {...props} />);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ReservationList server-scoped lists", () => {
  it("loads only unfinished bookings first and asks for history (30 days, 50 rows) only when the tab opens", async () => {
    const { listCalls } = mockApi((p) =>
      p.get("scope") === "active"
        ? { items: [row("p1", "pending", "2026-12-01T06:00:00Z")], total: 1 }
        : { items: [row("h1", "completed", "2026-10-10T06:00:00Z")], total: 1, nextCursor: null }
    );
    renderList();
    expect(await screen.findByText("P1")).toBeTruthy();
    expect(listCalls().map((p) => p.get("scope"))).toEqual(["active"]);

    fireEvent.click(screen.getByRole("button", { name: "歷史紀錄" }));
    expect(await screen.findByText("H1")).toBeTruthy();
    const history = listCalls().find((p) => p.get("scope") === "history")!;
    expect(history.get("range")).toBe("30d");
    expect(history.get("status")).toBe("all");
    expect(history.get("limit")).toBe("50");
    expect(history.get("cursor")).toBeNull();
  });

  it("keeps a past, still-confirmed booking under 即將到來 with the 沒來 action (#469)", async () => {
    mockApi((p) =>
      p.get("scope") === "active" ? { items: [row("old", "confirmed", "2025-01-01T06:00:00Z")] } : { items: [] }
    );
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "即將到來" }));
    expect(await screen.findByText("OLD")).toBeTruthy();
    expect(screen.getByRole("button", { name: /沒來/ })).toBeTruthy();
  });

  it("still opens history when there is no unfinished booking", async () => {
    mockApi((p) =>
      p.get("scope") === "active" ? { items: [] } : { items: [row("h1", "cancelled", "2026-10-10T06:00:00Z")], total: 1 }
    );
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "歷史紀錄" }));
    expect(await screen.findByText("H1")).toBeTruthy();
  });

  it("pages history with 載入更多 using the server cursor", async () => {
    const { listCalls } = mockApi((p) => {
      if (p.get("scope") === "active") return { items: [] };
      if (p.get("cursor") === "c1") return { items: [row("h3", "completed", "2026-10-08T06:00:00Z")], nextCursor: null, total: null };
      return {
        items: [row("h1", "completed", "2026-10-10T06:00:00Z"), row("h2", "no_show", "2026-10-09T06:00:00Z")],
        nextCursor: "c1",
        total: 3,
      };
    });
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "歷史紀錄" }));
    expect(await screen.findByText("已顯示 2／共 3 筆")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "載入更多" }));
    expect(await screen.findByText("H3")).toBeTruthy();
    expect(screen.getByText("H1")).toBeTruthy();
    expect(listCalls().some((p) => p.get("cursor") === "c1")).toBe(true);
    await waitFor(() => expect(screen.queryByRole("button", { name: "載入更多" })).toBeNull());
    expect(screen.getByText("共 3 筆")).toBeTruthy();
  });

  it("sends range, status chips and the search box to the server", async () => {
    const { listCalls } = mockApi((p) => (p.get("scope") === "active" ? { items: [] } : { items: [], total: 0 }));
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "歷史紀錄" }));
    await screen.findByText("這段期間沒有歷史紀錄，可改選較長的期間或「全部」");

    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    await waitFor(() => expect(listCalls().some((p) => p.get("range") === "all")).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "沒來" }));
    await waitFor(() => expect(listCalls().some((p) => p.get("status") === "no_show")).toBe(true));

    fireEvent.change(screen.getByLabelText("搜尋訂位"), { target: { value: "王小明" } });
    await waitFor(() => expect(listCalls().some((p) => p.get("q") === "王小明")).toBe(true));
    const last = listCalls().at(-1)!;
    expect(last.get("range")).toBe("all");
    expect(last.get("status")).toBe("no_show");
  });

  it("shows enrichment failures as a non-blocking warning instead of hiding them", async () => {
    mockApi((p) =>
      p.get("scope") === "active"
        ? { items: [row("p1", "pending", "2026-12-01T06:00:00Z")], warnings: ["付款待審核標記暫時無法載入"] }
        : { items: [] }
    );
    renderList();
    expect(await screen.findByText("P1")).toBeTruthy();
    expect(screen.getByText(/部分資料暫時無法載入/).textContent).toContain("付款待審核標記暫時無法載入");
  });

  it("uses the server's branch-wide visit count for the 熟客 badge", async () => {
    mockApi((p) =>
      p.get("scope") === "active" ? { items: [row("p1", "pending", "2026-12-01T06:00:00Z", { visit_count: 5 })] } : { items: [] }
    );
    renderList();
    expect(await screen.findByText(/熟客 ×5/)).toBeTruthy();
  });

  it("fetches a linked booking by id when it is outside the loaded range", async () => {
    const focusId = "11111111-1111-4111-8111-111111111111";
    const { listCalls } = mockApi((p) => {
      if (p.get("id") === focusId) return { items: [row(focusId, "completed", "2025-03-01T06:00:00Z")] };
      return { items: [] };
    });
    renderList({ focusReservationId: focusId });
    await waitFor(() => expect(listCalls().some((p) => p.get("id") === focusId)).toBe(true));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});
