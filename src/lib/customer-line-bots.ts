/**
 * Per-branch customer LINE Official Accounts (e.g. 「昇咖啡 桃園同德店」).
 *
 * Configured in Vercel as LINE_BRANCH_CUSTOMER_BOTS (JSON array, never logged):
 *   [{ "branch_id": "<branches.id>", "name": "同德店", "secret": "<channel secret>", "token": "<channel access token>" }]
 * Branches without an entry keep using the default customer account
 * (LINE_CUSTOMER_ACCESS_TOKEN / LINE_CHANNEL_SECRET), so behavior is unchanged until configured.
 */
import crypto from "node:crypto";

export type CustomerBot = { branchId: string; name: string; secret: string; token: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseBranchCustomerBots(raw: string | undefined | null): CustomerBot[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("[customer-line-bots] LINE_BRANCH_CUSTOMER_BOTS is not valid JSON; ignoring it");
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry, i) => {
    const e = entry as { branch_id?: unknown; name?: unknown; secret?: unknown; token?: unknown } | null;
    if (typeof e?.branch_id !== "string" || !UUID.test(e.branch_id) || typeof e.secret !== "string" || !e.secret
      || typeof e.token !== "string" || !e.token) {
      console.error(`[customer-line-bots] entry ${i} needs branch_id (uuid), secret and token; ignoring it`);
      return [];
    }
    return [{ branchId: e.branch_id, name: typeof e.name === "string" && e.name ? e.name : `branch-${i + 1}`, secret: e.secret, token: e.token }];
  });
}

export function branchCustomerBots(): CustomerBot[] {
  return parseBranchCustomerBots(process.env.LINE_BRANCH_CUSTOMER_BOTS);
}

/** Customer-account token for a branch: its own account when configured, else the default one. */
export function customerTokenForBranch(
  branchId: string | null | undefined,
  bots: CustomerBot[] = branchCustomerBots(),
  defaultToken = process.env.LINE_CUSTOMER_ACCESS_TOKEN
): string | undefined {
  const bot = branchId ? bots.find((b) => b.branchId === branchId) : undefined;
  return bot?.token ?? defaultToken;
}

function signatureMatches(body: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(body).digest("base64"));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** The branch customer account that signed a webhook body, if any. */
export function matchCustomerBotSignature(
  body: string,
  signature: string,
  bots: CustomerBot[] = branchCustomerBots()
): CustomerBot | null {
  if (!signature) return null;
  return bots.find((b) => signatureMatches(body, signature, b.secret)) ?? null;
}
