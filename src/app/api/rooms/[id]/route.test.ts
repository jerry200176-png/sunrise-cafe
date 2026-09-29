import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ updateRoom: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-fetch", () => ({ updateRoom: mocks.updateRoom, deleteRoom: vi.fn() }));
vi.mock("@/lib/admin-api-auth", () => ({ requireAdminApiAuth: vi.fn(async () => null) }));

import { PATCH } from "./route";

const SUPABASE = "https://abcd.supabase.co";
const patch = (body: object) =>
  PATCH(new NextRequest("http://localhost/api/rooms/r1", { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "r1" }),
  });

describe("PATCH /api/rooms/[id] photo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE);
  });

  it("saves an uploaded photo URL or clears it", async () => {
    const url = `${SUPABASE}/storage/v1/object/public/menu-photos/b1/p.jpg`;
    expect((await patch({ image_url: url })).status).toBe(200);
    expect(mocks.updateRoom).toHaveBeenLastCalledWith("r1", { image_url: url });
    expect((await patch({ image_url: null })).status).toBe(200);
    expect(mocks.updateRoom).toHaveBeenLastCalledWith("r1", { image_url: null });
  });

  it("rejects an external image link without touching the room", async () => {
    const res = await patch({ name: "A", image_url: "https://evil.example/x.jpg" });
    expect(res.status).toBe(400);
    expect(mocks.updateRoom).not.toHaveBeenCalled();
  });

  it("leaves the photo alone when the edit does not mention it", async () => {
    await patch({ name: "A包廂" });
    expect(mocks.updateRoom).toHaveBeenLastCalledWith("r1", { name: "A包廂" });
  });
});
