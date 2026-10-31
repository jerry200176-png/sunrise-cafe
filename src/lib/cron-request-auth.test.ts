import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  authorizeCronGet,
  isAdminCronGetPath,
  isVercelCronRequest,
} from "./cron-request-auth";

function req(headers: Record<string, string> = {}) {
  return new NextRequest("https://example.com/api/admin/reminders/send-line", {
    headers,
  });
}

describe("isAdminCronGetPath", () => {
  it("matches reminder cron paths", () => {
    expect(isAdminCronGetPath("/api/admin/reminders/send-line")).toBe(true);
    expect(isAdminCronGetPath("/api/admin/reminders/verify")).toBe(false);
  });
});

describe("isVercelCronRequest", () => {
  it("detects schedule header", () => {
    expect(isVercelCronRequest(req({ "x-vercel-cron-schedule": "0 12 * * *" }))).toBe(true);
    expect(isVercelCronRequest(req())).toBe(false);
  });
});

describe("authorizeCronGet", () => {
  beforeEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.VERCEL_ENV;
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("accepts Bearer CRON_SECRET when set", () => {
    process.env.CRON_SECRET = "s3cret";
    const r = authorizeCronGet(req({ authorization: "Bearer s3cret" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.via).toBe("cron_secret");
  });

  it("rejects wrong Bearer when CRON_SECRET set", () => {
    process.env.CRON_SECRET = "s3cret";
    const r = authorizeCronGet(req({ authorization: "Bearer wrong" }));
    expect(r.ok).toBe(false);
  });

  it("accepts Vercel cron header when CRON_SECRET unset", () => {
    const r = authorizeCronGet(req({ "x-vercel-cron-schedule": "0 12 * * *" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.via).toBe("vercel_cron_header");
  });

  it("rejects production request with neither secret nor cron header", () => {
    vi.stubEnv("NODE_ENV", "production");
    const r = authorizeCronGet(req());
    expect(r.ok).toBe(false);
  });
});
