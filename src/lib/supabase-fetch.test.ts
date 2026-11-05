import { afterEach, describe, expect, it, vi } from "vitest";

const ORIG_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIG_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ORIG_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIG_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ORIG_ANON;
  process.env.SUPABASE_SERVICE_ROLE_KEY = ORIG_SERVICE;
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("supabase-fetch admin mutations", () => {
  it("requires a server credential to read the full branch configuration", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { fetchBranches } = await import("./supabase-fetch");
    await expect(fetchBranches()).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the server credential for full branch reads and the anon key for public fields", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);
    const { fetchBranches, fetchPublicBranches } = await import("./supabase-fetch");
    await fetchBranches(true);
    await fetchPublicBranches();
    const [adminUrl, adminInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [publicUrl, publicInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((adminInit.headers as Record<string, string>).apikey).toBe("service-role-key");
    expect(adminUrl).toContain("select=*");
    expect((publicInit.headers as Record<string, string>).apikey).toBe("anon-key");
    expect(publicUrl).toContain("archived_at=is.null");
    expect(publicUrl).not.toContain("line_group_id");
    expect(publicUrl).not.toContain("payment_info");
    expect(publicUrl).not.toContain("line_pay_url");
  });

  it("refuses catalog writes without service role key", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { insertBranch } = await import("./supabase-fetch");
    await expect(insertBranch({ name: "x" })).rejects.toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/
    );
  });

  it("sends service role on branch insert", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "",
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { insertBranch } = await import("./supabase-fetch");
    await insertBranch({ name: "新分店" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer service-role-key");
    expect(headers.apikey).toBe("service-role-key");
  });

  it("preserves the current branch when an unrelated setting is updated, but permits explicit clearing", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const { updateSettings } = await import("./supabase-fetch");
    await updateSettings(undefined, undefined, undefined, "訂金說明");
    const first = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(first).not.toHaveProperty("current_branch_id");
    expect(first.deposit_info).toBe("訂金說明");
    await updateSettings(null);
    const second = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(second.current_branch_id).toBeNull();
  });
});
