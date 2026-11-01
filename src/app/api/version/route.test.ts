import { afterEach, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

it("returns the runtime deployment identity without caching", async () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a".repeat(40));
  vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_syntheticA");
  const response = await GET();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ commit: "a".repeat(40), deployment_id: "dpl_syntheticA" });
});

it("reports unknown deployment identity rather than fabricating one", async () => {
  vi.stubEnv("VERCEL_DEPLOYMENT_ID", undefined);
  expect((await (await GET()).json()).deployment_id).toBeNull();
});

it("uses the checked-out SHA supplied by a CLI release if Git metadata is absent", async () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined);
  vi.stubEnv("SUNRISE_RELEASE_SHA", "b".repeat(40));
  expect((await (await GET()).json()).commit).toBe("b".repeat(40));
});
