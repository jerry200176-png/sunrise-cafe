/**
 * Extra LINE group bots — one Official Account per branch so each store's staff
 * notifications use that account's own monthly message quota.
 *
 * Configured in Vercel as LINE_EXTRA_GROUP_BOTS (JSON array, never logged):
 *   [{ "name": "同德店", "secret": "<channel secret>", "token": "<channel access token>" }]
 * The default group bot stays LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET.
 */
import crypto from "node:crypto";

export type GroupBot = { name: string; secret: string; token: string };

const LINE_API = "https://api.line.me/v2/bot";

export function parseExtraGroupBots(raw: string | undefined | null): GroupBot[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("[line-group-bots] LINE_EXTRA_GROUP_BOTS is not valid JSON; ignoring it");
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry, i) => {
    const e = entry as Partial<GroupBot> | null;
    if (typeof e?.secret !== "string" || !e.secret || typeof e?.token !== "string" || !e.token) {
      console.error(`[line-group-bots] entry ${i} is missing secret or token; ignoring it`);
      return [];
    }
    return [{ name: typeof e.name === "string" && e.name ? e.name : `bot-${i + 1}`, secret: e.secret, token: e.token }];
  });
}

export function extraGroupBots(): GroupBot[] {
  return parseExtraGroupBots(process.env.LINE_EXTRA_GROUP_BOTS);
}

function signatureMatches(body: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(body).digest("base64"));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** Which bot signed this webhook: the default group bot, an extra branch bot, or nobody. */
export function matchWebhookBot(
  body: string,
  signature: string,
  defaultSecret = process.env.LINE_CHANNEL_SECRET,
  bots: GroupBot[] = extraGroupBots()
): { kind: "default" } | { kind: "extra"; bot: GroupBot } | null {
  if (!signature) return null;
  if (defaultSecret && signatureMatches(body, signature, defaultSecret)) return { kind: "default" };
  const bot = bots.find((b) => signatureMatches(body, signature, b.secret));
  return bot ? { kind: "extra", bot } : null;
}

// ponytail: per-instance cache; a bot moved between groups is picked up after the TTL.
const TOKEN_CACHE_TTL_MS = 10 * 60_000;
const tokenCache = new Map<string, { token: string; at: number }>();

export function clearGroupTokenCache() {
  tokenCache.clear();
}

/**
 * Token of the bot that is a member of `groupId`: an extra branch bot when it is in
 * the group (checked via the free group-summary API), else the default group bot.
 */
export async function tokenForGroup(
  groupId: string,
  defaultToken: string,
  bots: GroupBot[] = extraGroupBots(),
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  if (bots.length === 0) return defaultToken;
  const cached = tokenCache.get(groupId);
  if (cached && Date.now() - cached.at < TOKEN_CACHE_TTL_MS) return cached.token;
  let token = defaultToken;
  for (const bot of bots) {
    try {
      const res = await fetchImpl(`${LINE_API}/group/${encodeURIComponent(groupId)}/summary`, {
        headers: { Authorization: `Bearer ${bot.token}` },
        cache: "no-store",
      });
      if (res.ok) {
        token = bot.token;
        break;
      }
    } catch (err) {
      console.error(`[line-group-bots] membership check failed for ${bot.name}:`, err instanceof Error ? err.message : err);
    }
  }
  tokenCache.set(groupId, { token, at: Date.now() });
  return token;
}

/** Reply in a group with the bot that received the event (reply messages do not use push quota). */
export async function replyGroupText(token: string, replyToken: string, text: string, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(`${LINE_API}/message/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) throw new Error(`LINE reply 失敗：${res.status}`);
}

export function groupJoinedMessage(groupId: string): string {
  return `已加入群組 ✅\n此群組 ID：\n${groupId}\n\n請複製上面這串，貼到 Sunrise 後台「分店管理」→ 該分店的「LINE 群組 ID」。`;
}
