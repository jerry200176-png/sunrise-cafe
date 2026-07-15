import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../..");

describe("catalog RLS migration (static)", () => {
  const sql = readFileSync(
    join(ROOT, "supabase/migration-rls-catalog-read-only.sql"),
    "utf8"
  );

  it("is SELECT-only for anon on catalog tables", () => {
    expect(sql).toMatch(/Allow anon select branches/);
    expect(sql).toMatch(/Allow anon select rooms/);
    expect(sql).toMatch(/Allow anon select settings/);
    expect(sql).toMatch(/FOR SELECT TO anon/);
    expect(sql).not.toMatch(/FOR ALL TO anon/);
    expect(sql).toContain("20260715-rls-catalog-read-only");
  });

  it("supabase-fetch mutations require service role", () => {
    const src = readFileSync(join(ROOT, "src/lib/supabase-fetch.ts"), "utf8");
    expect(src).toContain("adminHeaders");
    expect(src).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(src).toMatch(/insertBranch[\s\S]*adminHeaders/);
    expect(src).toMatch(/updateSettings[\s\S]*adminHeaders/);
  });
});
