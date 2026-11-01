import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ unsafe: vi.fn(async (sql: string) => { void sql; return []; }), end: vi.fn(async () => {}) }));
vi.mock("postgres", () => ({ default: () => ({ unsafe: mocks.unsafe, end: mocks.end }) }));

beforeEach(() => {
  vi.resetModules(); mocks.unsafe.mockClear(); mocks.end.mockClear();
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("SUPABASE_DB_URL", "postgres://synthetic.invalid/database");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.invalid");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-".repeat(5));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("never probes or applies ops_events while other bootstrap probes are ready", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response("[]", { status: 200 }));
  vi.stubGlobal("fetch", fetchImpl);
  const { runBootstrapMigrations } = await import("./bootstrap-migrations");
  await runBootstrapMigrations();
  expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("ops_events"))).toBe(false);
  expect(mocks.unsafe).not.toHaveBeenCalled();
});

it("never applies ops_events even when unrelated bootstrap probes fail", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"unavailable"}', { status: 503 })));
  const { runBootstrapMigrations } = await import("./bootstrap-migrations");
  await runBootstrapMigrations();
  // Other legacy bootstrap migrations may still run; this test does not claim otherwise.
  expect(mocks.unsafe.mock.calls.some(([sql]) => /CREATE TABLE IF NOT EXISTS ops_events/i.test(sql))).toBe(false);
});
