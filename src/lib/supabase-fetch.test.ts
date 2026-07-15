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
});
