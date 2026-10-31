import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  room: { id: "room-1", branch_id: "branch-1" } as { id: string; branch_id: string } | null,
  branch: { id: "branch-1", archived_at: null } as { id: string; archived_at: string | null } | null,
  existing: [] as { id: string }[],
  from: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { GET, POST } from "./route";

function query(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "lt", "gt"]) {
    builder[method] = () => builder;
  }
  builder.maybeSingle = async () => result;
  builder.limit = async () => result;
  builder.order = async () => result;
  return builder;
}

function post() {
  return POST(new NextRequest("http://localhost/api/waitlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      room_id: "room-1",
      start_time: "2099-10-06T10:00:00+08:00",
      end_time: "2099-10-06T12:00:00+08:00",
      customer_name: "Guest",
      phone: "0912345678",
    }),
  }));
}

describe("waitlist API branch availability", () => {
  beforeEach(() => {
    mocks.room = { id: "room-1", branch_id: "branch-1" };
    mocks.branch = { id: "branch-1", archived_at: null };
    mocks.existing = [];
    mocks.from.mockReset().mockImplementation((table: string) => {
      if (table === "rooms") return query({ data: mocks.room, error: null });
      if (table === "branches") return query({ data: mocks.branch, error: null });
      if (table === "waitlist") {
        return {
          select: () => query({ data: mocks.existing, error: null }),
          insert: vi.fn(async () => ({ error: null })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    mocks.createClient.mockReset().mockReturnValue({ from: mocks.from });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a missing room before creating a waitlist entry", async () => {
    mocks.room = null;

    const response = await post();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "分店或包廂不存在，無法加入候位" });
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(["rooms"]);
  });

  it("rejects a missing branch before creating a waitlist entry", async () => {
    mocks.branch = null;

    const response = await post();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "分店或包廂不存在，無法加入候位" });
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(["rooms", "branches"]);
  });

  it("rejects an archived branch before checking or inserting waitlist rows", async () => {
    mocks.branch = { id: "branch-1", archived_at: "2099-10-01T00:00:00Z" };

    const response = await post();
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "該分店已停止接受候位" });
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(["rooms", "branches"]);
  });

  it("allows adding a waitlist entry for an active branch", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual([
      "rooms", "branches", "waitlist", "waitlist",
    ]);
  });

  it("keeps phone-based waitlist history lookup available", async () => {
    mocks.branch = { id: "branch-1", archived_at: "2099-10-01T00:00:00Z" };
    const history = [{ id: "entry-1", status: "waiting" }];
    mocks.from.mockImplementation((table: string) => {
      if (table !== "waitlist") throw new Error(`Unexpected table ${table}`);
      return { select: () => query({ data: history, error: null }) };
    });

    const response = await GET(new NextRequest("http://localhost/api/waitlist?phone=0912345678"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(history);
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(["waitlist"]);
  });
});
