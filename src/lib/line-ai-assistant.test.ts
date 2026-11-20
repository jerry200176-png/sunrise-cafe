import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ store: new Map<string, unknown>(), create: vi.fn() }));
vi.mock("@upstash/redis", () => ({
  Redis: {
    fromEnv: () => ({
      get: async (k: string) => h.store.get(k) ?? null,
      set: async (k: string, v: unknown) => void h.store.set(k, v),
      incr: async (k: string) => { const n = ((h.store.get(k) as number) ?? 0) + 1; h.store.set(k, n); return n; },
      expire: async () => 1,
    }),
  },
}));
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error { status = 500; }
  class Anthropic { beta = { messages: { create: h.create } }; }
  return { default: Object.assign(Anthropic, { APIError, RateLimitError: class extends APIError {}, AuthenticationError: class extends APIError {}, APIConnectionError: class extends APIError {} }) };
});

import { AI_FALLBACK_TEXT, AI_LIMIT_TEXT, AI_TOO_LONG_TEXT, GUEST_DAILY_LIMIT, aiAssistantEnabled, askAssistant, buildStoreFacts } from "./line-ai-assistant";

const ask = (question: string, userId = "U1") => askAssistant({ accountKey: "default", userId, question, facts: async () => "FACTS" });
const says = (text: string, stop_reason = "end_turn") => ({ content: [{ type: "text", text }], stop_reason });

beforeEach(() => {
  h.store.clear();
  h.create.mockReset().mockResolvedValue(says("平日每小時 NT$300。"));
  vi.unstubAllEnvs();
});

describe("aiAssistantEnabled", () => {
  it("is off unless the switch, the key and the counter store are all set", () => {
    expect(aiAssistantEnabled()).toBe(false);
    vi.stubEnv("AI_CS_ENABLED", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    expect(aiAssistantEnabled()).toBe(false); // no Upstash = no caps = stays off
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "u");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    expect(aiAssistantEnabled()).toBe(true);
  });
});

describe("buildStoreFacts", () => {
  it("lists real prices, hours and closed days, and nothing about payment accounts", () => {
    const facts = buildStoreFacts({
      today: "2026-11-20",
      branches: [{ id: "b1", name: "大安店", address: "台北市", phone: "02-1234", open_time: "08:00:00", close_time: "22:00:00", weekly_hours: { mon: null }, closed_dates: ["2026-11-01", "2026-12-25"], bank_account: "999" } as never],
      rooms: { b1: [{ name: "A 包廂", capacity: 8, min_capacity: 4, price_weekday: 300, price_weekend: 400 }] },
      settings: { rental_notes: [{ title: "注意事項", items: ["可帶外食"] }], deposit_info: null, closed_dates: [] },
    });
    expect(facts).toContain("A 包廂：4–8 人，平日 300，假日 400");
    expect(facts).toContain("週一 公休、週二 08:00–22:00");
    expect(facts).toContain("近期公休日：2026-12-25");
    expect(facts).toContain("可帶外食");
    expect(facts).not.toContain("999");
  });
});

describe("askAssistant", () => {
  it("answers from the store facts and keeps the conversation", async () => {
    expect(await ask("平日多少錢")).toEqual({ text: "平日每小時 NT$300。", outcome: "answer" });
    const first = h.create.mock.calls[0][0];
    expect(first.system[0].text).toContain("FACTS");
    expect(first.tools).toBeUndefined(); // the model can only talk
    await ask("那假日呢");
    expect(h.create.mock.calls[1][0].messages).toHaveLength(3);
  });

  it("returns the same answer for the same question within a minute without calling the model", async () => {
    await ask("幾點開");
    expect((await ask("幾點開")).outcome).toBe("repeat");
    expect(h.create).toHaveBeenCalledTimes(1);
  });

  it("stops at the guest's daily limit", async () => {
    for (let i = 0; i < GUEST_DAILY_LIMIT; i++) await ask(`問題 ${i}`);
    expect(await ask("再一題")).toEqual({ text: AI_LIMIT_TEXT, outcome: "limit" });
    expect(h.create).toHaveBeenCalledTimes(GUEST_DAILY_LIMIT);
  });

  it("refuses very long messages without calling the model", async () => {
    expect((await ask("字".repeat(501))).text).toBe(AI_TOO_LONG_TEXT);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("falls back to a safe sentence on a refusal or an API failure", async () => {
    h.create.mockResolvedValueOnce(says("", "refusal"));
    expect(await ask("a")).toEqual({ text: AI_FALLBACK_TEXT, outcome: "refusal" });
    h.create.mockRejectedValueOnce(new Error("boom"));
    expect(await ask("b")).toEqual({ text: AI_FALLBACK_TEXT, outcome: "error" });
  });
});
