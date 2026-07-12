import { describe, expect, it } from "vitest";
import {
  classifyFailure,
  triageInboxMessage,
  failureDedupeKey,
  buildRecommendations,
  dedupeMessages,
} from "../../scripts/lib/gmail-ops.mjs";

describe("gmail-ops", () => {
  it("classifies production Vercel failures as relevant", () => {
    const r = classifyFailure(
      "Failed production deployment on team 'x'",
      "notifications@vercel.com"
    );
    expect(r.relevant).toBe(true);
    expect(r.kind).toBe("vercel_production");
  });

  it("excludes Vercel preview failures from scan signals", () => {
    const r = classifyFailure(
      "Failed preview deployment on team 'x'",
      "notifications@vercel.com"
    );
    expect(r.relevant).toBe(false);
    expect(r.kind).toBe("vercel_preview");
  });

  it("archives GitHub PR Re: threads", () => {
    const r = triageInboxMessage(
      "Re: [jerry200176-png/sunrise-cafe] fix(foo) (PR #166)",
      "notifications@github.com",
      new Date().toISOString()
    );
    expect(r.archive).toBe(true);
    expect(r.reason).toBe("github_pr_thread");
  });

  it("keeps recent CI failures in inbox", () => {
    const r = triageInboxMessage(
      "[jerry200176-png/sunrise-cafe] Run failed: CI - main (abc1234)",
      "notifications@github.com",
      new Date().toISOString()
    );
    expect(r.archive).toBe(false);
    expect(r.reason).toBe("recent_ci_failure");
  });

  it("archives stale CI failures", () => {
    const old = new Date(Date.now() - 96 * 3_600_000).toISOString();
    const r = triageInboxMessage(
      "[jerry200176-png/sunrise-cafe] Run failed: CI - main (abc1234)",
      "notifications@github.com",
      old
    );
    expect(r.archive).toBe(true);
    expect(r.reason).toBe("stale_ci_failure");
  });

  it("dedupes repeated failure subjects", () => {
    const msgs = [
      { subject: "[jerry200176-png/sunrise-cafe] Run failed: CI - main (a)", from: "notifications@github.com" },
      { subject: "[jerry200176-png/sunrise-cafe] Run failed: CI - main (b)", from: "notifications@github.com" },
    ];
    expect(dedupeMessages(msgs)).toHaveLength(1);
    expect(failureDedupeKey(msgs[0].subject, msgs[0].from)).toBe(
      failureDedupeKey(msgs[1].subject, msgs[1].from)
    );
  });

  it("suppresses prod fail recommendation when SHA matches", () => {
    const recs = buildRecommendations(
      [{ kind: "vercel_production", date: new Date().toISOString(), subject: "", from: "" }],
      { prodShaMatchesMain: true }
    );
    expect(recs.some((r) => r.signal === "vercel_production_failure")).toBe(false);
    expect(recs.some((r) => r.signal === "vercel_production_failure_resolved")).toBe(true);
  });
});
