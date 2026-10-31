// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAdminBranches } from "./use-admin-branches";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/fetch-with-timeout", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/fetch-with-timeout")>(),
  fetchWithTimeout: fetchMock,
}));

describe("useAdminBranches", () => {
  beforeEach(() => fetchMock.mockReset());

  it("shows an HTTP failure instead of pretending there are no branches, and recovers on retry", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ id: "b1", name: "大安店" }]), { status: 200 }));
    const { result } = renderHook(() => useAdminBranches());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.loading).toBe(false);
    await act(async () => { await result.current.retry(); });
    expect(result.current.error).toBeNull();
    expect(result.current.branches.map((branch) => branch.id)).toEqual(["b1"]);
  });

  it("ignores an older response after a newer retry succeeds", async () => {
    let resolveOld!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveOld = resolve; }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ id: "new" }]), { status: 200 }));
    const { result } = renderHook(() => useAdminBranches());
    await act(async () => { await result.current.retry(); });
    await act(async () => { resolveOld(new Response(JSON.stringify([{ id: "old" }]), { status: 200 })); });
    expect(result.current.branches.map((branch) => branch.id)).toEqual(["new"]);
  });
});
