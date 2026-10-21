/**
 * Which LINE Official Account each configured token belongs to, and its monthly quota.
 *
 * Read-only: GET /v2/bot/info plus the quota endpoints in line-usage.ts. None of these
 * send a message or count against the quota. Token values never leave this module;
 * results carry only the account's display name, basic ID and usage numbers.
 */
import { fetchLineQuotaAudit } from "@/lib/line-usage";
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
  error: string | null;
  usage: {
    status: "complete" | "partial" | "unavailable";
    monthUsed: number | null;
    monthLimit: number | null;
    planType: "none" | "limited" | null;
    todayPush: number | null;
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
};

type TokenSlot = { role: LineAccountRole; source: string; token: string | undefined };

/** Every token the app sends with, from the environment (values stay inside this module). */
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

async function botInfo(token: string, fetchImpl: typeof fetch) {
  try {
    const response = await fetchImpl("https://api.line.me/v2/bot/info", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) return { error: `token 無效或已過期（LINE 回 ${response.status}）` };
    const info = (await response.json()) as { userId?: string; displayName?: string; basicId?: string };
    return { userId: info.userId ?? null, displayName: info.displayName ?? null, basicId: info.basicId ?? null };
  } catch {
    return { error: "連不上 LINE" };
  }
}

export async function auditLineAccounts(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  now = new Date()
): Promise<LineAccountAudit> {
  const slots = configuredLineTokens(env);
  const resolved = await Promise.all(slots.map(async (slot) => {
    if (!slot.token) {
      return { slot, userId: null, report: {
        role: slot.role, source: slot.source, configured: false, displayName: null, basicId: null,
        error: "未設定", usage: null,
      } satisfies LineAccountReport };
    }
    const [info, quota] = await Promise.all([
      botInfo(slot.token, fetchImpl),
      fetchLineQuotaAudit(slot.token, now, fetchImpl),
    ]);
    return { slot, userId: "userId" in info ? info.userId : null, report: {
      role: slot.role,
      source: slot.source,
      configured: true,
      displayName: "displayName" in info ? info.displayName : null,
      basicId: "basicId" in info ? info.basicId : null,
      error: "error" in info ? info.error ?? null : null,
      usage: {
        status: quota.status,
        monthUsed: quota.snapshot.used,
        monthLimit: quota.snapshot.limit,
        planType: quota.snapshot.limitType,
        todayPush: quota.snapshot.dailyPush,
      },
    } satisfies LineAccountReport };
  }));

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

  return { fetchedAt: now.toISOString(), accounts: resolved.map((r) => r.report), collisions };
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
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<{ collisions: number; alerted: boolean }> {
  try {
    const audit = await auditLineAccounts(env, fetchImpl);
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
