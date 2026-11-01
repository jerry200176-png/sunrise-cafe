import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  ADMIN_CRON_GET_PATHS,
  authorizeCronGet,
  isAdminCronGetPath,
  isVercelCronRequest,
} from "./cron-request-auth";

function req(headers: Record<string, string> = {}) {
  return new NextRequest("https://example.com/api/admin/reminders/send-line", {
    headers,
  });
}

const FORGED_CRON_HEADER = { "x-vercel-cron-schedule": "0 12 * * *" };

describe("isAdminCronGetPath", () => {
  it("matches reminder cron paths", () => {
    expect(isAdminCronGetPath("/api/admin/reminders/send-line")).toBe(true);
    expect(isAdminCronGetPath("/api/admin/reminders/verify")).toBe(false);
  });

  it("covers every cron path scheduled in vercel.json", async () => {
    const { readFileSync } = await import("node:fs");
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string }[];
    };
    for (const cron of vercel.crons) {
      expect(ADMIN_CRON_GET_PATHS).toContain(cron.path);
    }
  });
});

describe("isVercelCronRequest", () => {
  it("detects schedule header", () => {
    expect(isVercelCronRequest(req(FORGED_CRON_HEADER))).toBe(true);
    expect(isVercelCronRequest(req())).toBe(false);
  });
});

describe("authorizeCronGet", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("accepts Bearer CRON_SECRET when set", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubEnv("NODE_ENV", "production");
    const r = authorizeCronGet(req({ authorization: "Bearer s3cret" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.via).toBe("cron_secret");
  });

  it("rejects wrong Bearer when CRON_SECRET set", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const r = authorizeCronGet(req({ authorization: "Bearer wrong" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it("rejects a prefix of the secret", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const r = authorizeCronGet(req({ authorization: "Bearer s3cre" }));
    expect(r.ok).toBe(false);
  });

  it("rejects the cron header alone when CRON_SECRET is set", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubEnv("NODE_ENV", "production");
    const r = authorizeCronGet(req(FORGED_CRON_HEADER));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it("fails closed (500) in production when CRON_SECRET is unset, even with the cron header", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = authorizeCronGet(req(FORGED_CRON_HEADER));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(500);
  });

  it("rejects a production request with neither secret nor cron header", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = authorizeCronGet(req());
    expect(result.ok).toBe(false);
  });

  it("fails closed when VERCEL_ENV=production even if NODE_ENV is not", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = authorizeCronGet(req({ ...FORGED_CRON_HEADER, authorization: "Bearer " }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(500);
  });

  it("treats a whitespace-only CRON_SECRET as unset", () => {
    vi.stubEnv("CRON_SECRET", "   ");
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = authorizeCronGet(req({ authorization: "Bearer    " }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(500);
  });

  it("allows local dev/test without CRON_SECRET", () => {
    const r = authorizeCronGet(req());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.via).toBe("cron_secret_unset_dev");
  });
});
