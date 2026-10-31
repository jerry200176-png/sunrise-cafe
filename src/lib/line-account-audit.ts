/**
 * Which LINE Official Account each configured token belongs to (GET /v2/bot/info, read-only,
 * no message quota used), plus the same-account check between customer and staff group tokens.
 *
 * Quota numbers are not fetched here: customer accounts reuse fetchCustomerLineQuotaAudits and
 * group bots fetchLineQuotaAudit, both graded with assessLineQuota (src/lib/line-usage.ts).
 * Token values and bot userIds never leave this module.
 */
import {
  assessLineQuota,
  fetchCustomerLineQuotaAudits,
  fetchLineQuotaAudit,
  type LineQuotaAudit,
  type LineQuotaLevel,
} from "@/lib/line-usage";
import { parseExtraGroupBots } from "@/lib/line-group-bots";
import { parseBranchCustomerBots } from "@/lib/customer-line-bots";

export type LineAccountRole = "group" | "customer";

export type LineAccountReport = {
  role: LineAccountRole;
  /** Where the token comes from, e.g. "LINE_CUSTOMER_ACCESS_TOKEN" or "LINE_BRANCH_CUSTOMER_BOTS[同德店]". */
  source: string;
  configured: boolean;
  displayName: string | null;
  basicId: string | null;
  /** Bot identity could not be read (invalid token, LINE unreachable). */
  error: string | null;
  usage: {
    status: LineQuotaAudit["status"];
    monthUsed: number | null;
    monthLimit: number | null;
    planType: "none" | "limited" | null;
    todayPush: number | null;
    level: LineQuotaLevel;
    percentUsed: number | null;
  } | null;
};

export type LineAccountCollision = {
  customerSource: string;
  groupSource: string;
  displayName: string | null;
  basicId: string | null;
};

export type LineAccountAudit = {
  fetchedAt: string;
  accounts: LineAccountReport[];
  /** A customer token that resolves to the same account as a staff group token. */
  collisions: LineAccountCollision[];
  /**
   * True only when every configured token's identity was read. When false, "no collision"
   * is not proof the accounts differ.
   */
  identityComplete: boolean;
};

type TokenSlot = { role: LineAccountRole; source: string; token: string | undefined };

/** Group tokens first, then customer tokens in the order fetchCustomerLineQuotaAudits returns them. */
export function configuredLineTokens(env: NodeJS.ProcessEnv = process.env): TokenSlot[] {
  return [
    { role: "group", source: "LINE_CHANNEL_ACCESS_TOKEN", token: env.LINE_CHANNEL_ACCESS_TOKEN?.trim() || undefined },
    ...parseExtraGroupBots(env.LINE_EXTRA_GROUP_BOTS).map((bot) => ({
      role: "group" as const, source: `LINE_EXTRA_GROUP_BOTS[${bot.name}]`, token: bot.token,
    })),
    { role: "customer", source: "LINE_CUSTOMER_ACCESS_TOKEN", token: env.LINE_CUSTOMER_ACCESS_TOKEN?.trim() || undefined },
    ...parseBranchCustomerBots(env.LINE_BRANCH_CUSTOMER_BOTS).map((bot) => ({
      role: "customer" as const, source: `LINE_BRANCH_CUSTOMER_BOTS[${bot.name}]`, token: bot.token,
    })),
  ];
}

async function botInfo(token: string): Promise<{ userId: string | null; displayName: string | null; basicId: string | null; error: string | null }> {
  try {
    const response = await fetch("https://api.line.me/v2/bot/info", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { userId: null, displayName: null, basicId: null, error: `LINE 回 ${response.status}，無法確認帳號` };
    const info = (await response.json()) as { userId?: string; displayName?: string; basicId?: string };
    if (!info.userId) return { userId: null, displayName: info.displayName ?? null, basicId: info.basicId ?? null, error: "LINE 沒有回帳號 ID" };
    return { userId: info.userId, displayName: info.displayName ?? null, basicId: info.basicId ?? null, error: null };
  } catch {
    return { userId: null, displayName: null, basicId: null, error: "連不上 LINE" };
  }
}

function usageOf(audit: LineQuotaAudit): NonNullable<LineAccountReport["usage"]> {
  return {
    status: audit.status,
    monthUsed: audit.snapshot.used,
    monthLimit: audit.snapshot.limit,
    planType: audit.snapshot.limitType,
    todayPush: audit.snapshot.dailyPush,
    ...assessLineQuota(audit.snapshot),
  };
}

export async function auditLineAccounts(env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<LineAccountAudit> {
  const slots = configuredLineTokens(env);
  const groupSlots = slots.filter((slot) => slot.role === "group");
  const customerSlots = slots.filter((slot) => slot.role === "customer");

  const [customerQuotas, groupQuotas, identities] = await Promise.all([
    fetchCustomerLineQuotaAudits(env, now),
    Promise.all(groupSlots.map((slot) => (slot.token ? fetchLineQuotaAudit(slot.token, now) : Promise.resolve(null)))),
    Promise.all(slots.map((slot) => (slot.token ? botInfo(slot.token) : Promise.resolve(null)))),
  ]);
  const quotaFor = (slot: TokenSlot): LineQuotaAudit | null => {
    if (!slot.token) return null;
    if (slot.role === "group") return groupQuotas[groupSlots.indexOf(slot)];
    return customerQuotas[customerSlots.indexOf(slot)]?.audit ?? null;
  };

  const resolved = slots.map((slot, i) => {
    const info = identities[i];
    const quota = quotaFor(slot);
    const report: LineAccountReport = {
      role: slot.role,
      source: slot.source,
      configured: Boolean(slot.token),
      displayName: info?.displayName ?? null,
      basicId: info?.basicId ?? null,
      error: slot.token ? info?.error ?? null : "未設定",
      usage: quota ? usageOf(quota) : null,
    };
    return { slot, userId: info?.userId ?? null, report };
  });

  const collisions: LineAccountCollision[] = [];
  for (const customer of resolved.filter((r) => r.slot.role === "customer" && r.userId)) {
    for (const group of resolved.filter((r) => r.slot.role === "group" && r.userId)) {
      if (customer.userId === group.userId) {
        collisions.push({
          customerSource: customer.slot.source,
          groupSource: group.slot.source,
          displayName: customer.report.displayName,
          basicId: customer.report.basicId,
        });
      }
    }
  }

  return {
    fetchedAt: now.toISOString(),
    accounts: resolved.map((r) => r.report),
    collisions,
    identityComplete: resolved.every((r) => !r.slot.token || r.userId !== null),
  };
}

export function formatCollisionAlert(collisions: LineAccountCollision[]): string {
  const lines = collisions.map((c) =>
    `・${c.customerSource} 和 ${c.groupSource} 是同一個帳號（${c.displayName ?? "?"} ${c.basicId ?? ""}）`.trim());
  return [
    "⚠️【LINE 帳號設定錯誤】客人通知和店員群組用了同一個 LINE 官方帳號，兩邊共用同一份每月訊息額度。",
    ...lines,
    "請到 Vercel 環境變數改回客人帳號的 token，然後 Redeploy。後台「LINE 帳號檢查」頁可確認。",
  ].join("\n");
}

/**
 * Daily self-check (deploy-health cron): alert the staff group once when a customer token
 * resolves to a staff group bot. Best-effort; never throws.
 */
export async function checkLineAccountsAndAlert(
  send: (text: string) => Promise<void>,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ collisions: number; alerted: boolean }> {
  try {
    const audit = await auditLineAccounts(env);
    if (audit.collisions.length === 0) return { collisions: 0, alerted: false };
    console.error("[line-account-audit] customer token resolves to a staff group bot:",
      audit.collisions.map((c) => `${c.customerSource}=${c.groupSource}`).join(", "));
    await send(formatCollisionAlert(audit.collisions));
    return { collisions: audit.collisions.length, alerted: true };
  } catch (error) {
    console.error("[line-account-audit] self-check failed:", error instanceof Error ? error.message : error);
    return { collisions: 0, alerted: false };
  }
}
