import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearGroupTokenCache,
  groupJoinedMessage,
  matchWebhookBot,
  parseExtraGroupBots,
  tokenForGroup,
} from "./line-group-bots";

const sign = (body: string, secret: string) => crypto.createHmac("sha256", secret).update(body).digest("base64");
const tongde = { name: "同德店", secret: "tongde-secret", token: "tongde-token" };

describe("parseExtraGroupBots", () => {
  it("keeps complete entries and ignores broken config without throwing", () => {
    expect(parseExtraGroupBots(JSON.stringify([tongde, { name: "x", secret: "" , token: "t" }]))).toEqual([tongde]);
    expect(parseExtraGroupBots("not json")).toEqual([]);
    expect(parseExtraGroupBots(undefined)).toEqual([]);
    expect(parseExtraGroupBots('{"secret":"s","token":"t"}')).toEqual([]);
  });
});

describe("matchWebhookBot", () => {
  const body = '{"events":[]}';
  it("identifies the default bot, an extra branch bot, or rejects", () => {
    expect(matchWebhookBot(body, sign(body, "default-secret"), "default-secret", [tongde])).toEqual({ kind: "default" });
    expect(matchWebhookBot(body, sign(body, tongde.secret), "default-secret", [tongde])).toEqual({ kind: "extra", bot: tongde });
    expect(matchWebhookBot(body, sign(body, "attacker"), "default-secret", [tongde])).toBeNull();
    expect(matchWebhookBot(body, "", "default-secret", [tongde])).toBeNull();
  });
});

describe("tokenForGroup", () => {
  beforeEach(() => clearGroupTokenCache());

  it("uses the branch bot that is a member of the group, and caches the answer", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await tokenForGroup("C-tongde", "default-token", [tongde], fetchImpl as never)).toBe("tongde-token");
    expect(await tokenForGroup("C-tongde", "default-token", [tongde], fetchImpl as never)).toBe("tongde-token");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toContain("/group/C-tongde/summary");
  });

  it("falls back to the default bot when no branch bot is in the group or LINE is unreachable", async () => {
    const notMember = vi.fn(async () => new Response("{}", { status: 404 }));
    expect(await tokenForGroup("C-daan", "default-token", [tongde], notMember as never)).toBe("default-token");
    clearGroupTokenCache();
    const down = vi.fn(async () => { throw new Error("network"); });
    expect(await tokenForGroup("C-daan", "default-token", [tongde], down as never)).toBe("default-token");
  });

  it("does not call LINE at all when no extra bots are configured", async () => {
    const fetchImpl = vi.fn();
    expect(await tokenForGroup("C-daan", "default-token", [], fetchImpl as never)).toBe("default-token");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

it("join message shows the group id to paste into the admin", () => {
  expect(groupJoinedMessage("C123")).toContain("C123");
});
