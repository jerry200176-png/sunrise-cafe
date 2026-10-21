import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  TABLE_PROBE_SELECT,
  collectRestProbes,
  probeRestReadable,
  type TrackedMigrationContract,
} from "@/lib/migration-verify";

// Regression: composite-PK tables (no `id` column) were reported "absent" because
// the table-existence probe selected `id` (PostgREST 42703).
const TABLES_WITHOUT_ID = new Set(["admin_user_branches", "menu_option_set_items"]);

function mockPostgrest() {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      urls.push(String(input));
      const u = new URL(String(input));
      const table = u.pathname.split("/").pop() ?? "";
      const select = u.searchParams.get("select") ?? "";
      if (TABLES_WITHOUT_ID.has(table) && select.split(",").includes("id")) {
        return new Response('{"code":"42703","message":"column id does not exist"}', {
          status: 400,
        });
      }
      return new Response("[]", { status: 200 });
    })
  );
  return urls;
}

describe("table-existence probe does not assume an id column", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefghijklmnop.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.sig";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("probes select=* with limit=0 and reports a no-id table as present", async () => {
    const urls = mockPostgrest();
    expect(await probeRestReadable("admin_user_branches", TABLE_PROBE_SELECT)).toBe(true);
    expect(urls[0]).toContain("select=*");
    expect(urls[0]).toContain("limit=0");
  });

  it("collectRestProbes marks composite-PK tables present, missing tables absent", async () => {
    mockPostgrest();
    const contracts = [
      {
        version: "x",
        evidence: [
          { type: "table", name: "admin_user_branches", introspect: "rest" },
          { type: "table", name: "menu_option_set_items", introspect: "rest" },
        ],
      },
    ] as unknown as TrackedMigrationContract[];
    const probes = await collectRestProbes(contracts);
    expect(probes["admin_user_branches.*"]).toBe(true);
    expect(probes["menu_option_set_items.*"]).toBe(true);
  });

  it("still reports a genuinely missing table as absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"code":"PGRST205"}', { status: 404 }))
    );
    expect(await probeRestReadable("no_such_table", TABLE_PROBE_SELECT)).toBe(false);
  });

  it("reconcile-migration-ledger.mjs uses the same id-free table probe", () => {
    const src = readFileSync(
      join(__dirname, "../../scripts/reconcile-migration-ledger.mjs"),
      "utf8"
    );
    expect(src).not.toMatch(/probeColumn\([^)]*"id"\)/);
    expect(src).toContain('TABLE_PROBE_SELECT = "*"');
  });
});
