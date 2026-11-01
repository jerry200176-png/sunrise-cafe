import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ unsafe: vi.fn(async (sql: string) => { void sql; return []; }), end: vi.fn(async () => {}), open: vi.fn() }));
vi.mock("postgres", () => ({ default: mocks.open }));

beforeEach(() => {
  vi.resetModules(); mocks.unsafe.mockClear(); mocks.end.mockClear(); mocks.open.mockClear();
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("SUPABASE_DB_URL", "postgres://synthetic.invalid/database");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.invalid");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-".repeat(5));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("does not connect, probe or execute SQL even with configured synthetic credentials", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response("[]", { status: 200 }));
  vi.stubGlobal("fetch", fetchImpl);
  const { runBootstrapMigrations } = await import("./bootstrap-migrations");
  await runBootstrapMigrations();
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.unsafe).not.toHaveBeenCalled();
});

it("does not probe or execute SQL with missing REST credentials", async () => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  const fetchImpl = vi.fn(async () => new Response('{"error":"unavailable"}', { status: 503 }));
  vi.stubGlobal("fetch", fetchImpl);
  const { runBootstrapMigrations } = await import("./bootstrap-migrations");
  await runBootstrapMigrations();
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.unsafe).not.toHaveBeenCalled();
});
