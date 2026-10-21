import { parseBranchCustomerBots } from "@/lib/customer-line-bots";

export type LineNotificationPriority = "critical" | "actionable" | "informational";

export type LineQuotaSnapshot = {
  used: number | null;
  limit: number | null;
  limitType: "none" | "limited" | null;
  dailyPush: number | null;
  fetchedAt: string;
};

export type LineQuotaEndpoint<T> = {
  available: boolean;
  value: T | null;
  error?: string;
};

export type LineQuotaAudit = {
  source: "line_official_api";
  status: "complete" | "partial" | "unavailable";
  endpoints: {
    consumption: LineQuotaEndpoint<number>;
    quota: LineQuotaEndpoint<{ value: number | null; type: "none" | "limited" | null }>;
    dailyPush: LineQuotaEndpoint<number>;
  };
  snapshot: LineQuotaSnapshot;
  fetchedAt: string;
};

export type LineUsageDecision = {
  allowed: boolean;
  reason:
    | "local_guard_exempt"
    | "local_guard_disabled"
    | "no_budget"
    | "within_budget"
    | "monthly_budget"
    | "monthly_limit"
    | "surge";
  projectedUsage: number | null;
};

export type LineUsageBudget = {
  enabled: boolean;
  monthlyBudget: number | null;
  expectedDaily: number | null;
  surgeMultiplier: number;
};

function positiveInteger(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Disabled by default until production quota and thresholds are verified. */
export function readLineUsageBudget(env: NodeJS.ProcessEnv = process.env): LineUsageBudget {
  return {
    enabled: /^(1|true|yes)$/i.test(env.LINE_USAGE_GUARD_ENABLED?.trim() ?? ""),
    monthlyBudget: positiveInteger(env.LINE_MONTHLY_MESSAGE_BUDGET),
    expectedDaily: positiveInteger(env.LINE_EXPECTED_DAILY_MESSAGES),
    surgeMultiplier: positiveNumber(env.LINE_USAGE_SURGE_MULTIPLIER, 3),
  };
}

function elapsedMonthDays(now: Date): number {
  return Math.max(1, now.getDate());
}

/**
 * Critical/actionable notifications bypass this local guard. That is not a
 * provider-delivery guarantee: LINE may still reject or fail to deliver them.
 */
export function decideLineUsage(
  priority: LineNotificationPriority,
  snapshot: Pick<LineQuotaSnapshot, "used" | "limit"> | null,
  budget: LineUsageBudget,
  projectedMessages = 1,
  now = new Date()
): LineUsageDecision {
  if (priority !== "informational") {
    return { allowed: true, reason: "local_guard_exempt", projectedUsage: null };
  }
  if (!budget.enabled) {
    return { allowed: true, reason: "local_guard_disabled", projectedUsage: null };
  }
  if (!snapshot || snapshot.used == null) {
    return { allowed: true, reason: "no_budget", projectedUsage: null };
  }

  const projectedUsage = snapshot.used + Math.max(1, projectedMessages);
  if (budget.monthlyBudget != null && projectedUsage > budget.monthlyBudget) {
    return { allowed: false, reason: "monthly_budget", projectedUsage };
  }
  if (snapshot.limit != null && projectedUsage > snapshot.limit) {
    return { allowed: false, reason: "monthly_limit", projectedUsage };
  }
  if (budget.expectedDaily != null) {
    const expectedThroughToday =
      budget.expectedDaily * elapsedMonthDays(now) * budget.surgeMultiplier;
    if (snapshot.used > expectedThroughToday) {
      return { allowed: false, reason: "surge", projectedUsage };
    }
  }
  return { allowed: true, reason: "within_budget", projectedUsage };
}

function tokyoDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

async function getJson<T>(url: string, token: string): Promise<{ data: T | null; error?: string }> {
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) return { data: null, error: `HTTP ${response.status}` };
    return { data: (await response.json()) as T };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : "request failed" };
  }
}

function unavailableQuotaAudit(error: string, now: Date): LineQuotaAudit {
  const fetchedAt = now.toISOString();
  return {
    source: "line_official_api",
    status: "unavailable",
    endpoints: {
      consumption: { available: false, value: null, error },
      quota: { available: false, value: null, error },
      dailyPush: { available: false, value: null, error },
    },
    snapshot: { used: null, limit: null, limitType: null, dailyPush: null, fetchedAt },
    fetchedAt,
  };
}

/** Read-only LINE quota and today's Messaging API push consumption. */
export async function fetchLineQuotaAudit(
  token = process.env.LINE_CHANNEL_ACCESS_TOKEN,
  now = new Date()
): Promise<LineQuotaAudit> {
  if (!token) return unavailableQuotaAudit("LINE_CHANNEL_ACCESS_TOKEN unavailable", now);

  const [consumption, quota, delivery] = await Promise.all([
    getJson<{ totalUsage?: number }>(
      "https://api.line.me/v2/bot/message/quota/consumption",
      token
    ),
    getJson<{ value?: number; type?: "none" | "limited" }>(
      "https://api.line.me/v2/bot/message/quota",
      token
    ),
    getJson<{ status?: string; success?: number }>(
      `https://api.line.me/v2/bot/message/delivery/push?date=${tokyoDate(now)}`,
      token
    ),
  ]);

  const consumptionEndpoint: LineQuotaEndpoint<number> = {
    available: typeof consumption.data?.totalUsage === "number",
    value: typeof consumption.data?.totalUsage === "number" ? consumption.data.totalUsage : null,
    ...(consumption.error ? { error: consumption.error } : {}),
  };
  const quotaEndpoint: LineQuotaEndpoint<{ value: number | null; type: "none" | "limited" | null }> = {
    available: typeof quota.data?.value === "number" || quota.data?.type === "none",
    value: quota.data
      ? { value: typeof quota.data.value === "number" ? quota.data.value : null, type: quota.data.type ?? null }
      : null,
    ...(quota.error ? { error: quota.error } : {}),
  };
  const dailyReady = delivery.data?.status === "ready" && typeof delivery.data.success === "number";
  const dailyEndpoint: LineQuotaEndpoint<number> = {
    available: dailyReady,
    value: dailyReady ? delivery.data!.success! : null,
    ...(delivery.error ? { error: delivery.error } : dailyReady ? {} : { error: "LINE delivery report not ready" }),
  };
  const availableCount = [consumptionEndpoint, quotaEndpoint, dailyEndpoint].filter((endpoint) => endpoint.available).length;
  const status = availableCount === 3 ? "complete" : availableCount === 0 ? "unavailable" : "partial";
  const fetchedAt = now.toISOString();

  return {
    source: "line_official_api",
    status,
    endpoints: { consumption: consumptionEndpoint, quota: quotaEndpoint, dailyPush: dailyEndpoint },
    snapshot: {
      used: consumptionEndpoint.value,
      limit: quotaEndpoint.value?.value ?? null,
      limitType: quotaEndpoint.value?.type ?? null,
      dailyPush: dailyEndpoint.value,
      fetchedAt,
    },
    fetchedAt,
  };
}

export async function fetchLineQuotaSnapshot(
  token = process.env.LINE_CHANNEL_ACCESS_TOKEN,
  now = new Date()
): Promise<LineQuotaSnapshot> {
  return (await fetchLineQuotaAudit(token, now)).snapshot;
}

export function estimateMonthlyMessageConsumption(input: {
  days: number;
  groupDigestRuns: number;
  groupDigestMessagesPerRun: number;
  guestDigestRecipients: number;
  guestDigestMessagesPerRecipient: number;
  depositReminderRecipients: number;
  depositReminderMessagesPerRecipient: number;
  lifecycleGroupMessages: number;
  lifecycleGuestMessages: number;
  informationalHeartbeats: number;
}): number {
  return (
    input.groupDigestRuns * input.groupDigestMessagesPerRun +
    input.guestDigestRecipients * input.guestDigestMessagesPerRecipient +
    input.depositReminderRecipients * input.depositReminderMessagesPerRecipient +
    input.lifecycleGroupMessages +
    input.lifecycleGuestMessages +
    input.informationalHeartbeats
  );
}

/** Usage level of one LINE account: "unknown" when the plan is unlimited or the quota is unreadable. */
export type LineQuotaLevel = "ok" | "warn" | "critical" | "unknown";

export const LINE_QUOTA_WARN_RATIO = 0.8;
export const LINE_QUOTA_CRITICAL_RATIO = 0.95;

export function assessLineQuota(
  snapshot: Pick<LineQuotaSnapshot, "used" | "limit" | "limitType">
): { level: LineQuotaLevel; percentUsed: number | null } {
  if (snapshot.limitType === "none" || snapshot.used == null || !snapshot.limit) {
    return { level: "unknown", percentUsed: null };
  }
  const ratio = snapshot.used / snapshot.limit;
  const percentUsed = Math.round(ratio * 1000) / 10;
  if (ratio >= LINE_QUOTA_CRITICAL_RATIO) return { level: "critical", percentUsed };
  if (ratio >= LINE_QUOTA_WARN_RATIO) return { level: "warn", percentUsed };
  return { level: "ok", percentUsed };
}

export type CustomerLineQuotaAudit = {
  /** Safe display label; never the token. */
  label: string;
  kind: "default" | "branch";
  branchId: string | null;
  audit: LineQuotaAudit;
  level: LineQuotaLevel;
  percentUsed: number | null;
};

/**
 * Read-only quota of the customer-facing official accounts: the default one
 * (LINE_CUSTOMER_ACCESS_TOKEN) plus each per-branch bot (LINE_BRANCH_CUSTOMER_BOTS).
 * Each account has its own quota, so each is queried separately; accounts sharing a
 * token are queried once. Tokens are never returned.
 */
export async function fetchCustomerLineQuotaAudits(
  env: NodeJS.ProcessEnv = process.env,
  now = new Date()
): Promise<CustomerLineQuotaAudit[]> {
  const accounts: { label: string; kind: "default" | "branch"; branchId: string | null; token: string | undefined }[] = [
    { label: "customer-default", kind: "default", branchId: null, token: env.LINE_CUSTOMER_ACCESS_TOKEN },
    ...parseBranchCustomerBots(env.LINE_BRANCH_CUSTOMER_BOTS).map((bot) => ({
      label: bot.name,
      kind: "branch" as const,
      branchId: bot.branchId,
      token: bot.token,
    })),
  ];
  const cache = new Map<string, Promise<LineQuotaAudit>>();
  return Promise.all(
    accounts.map(async ({ token, ...account }) => {
      // Never call fetchLineQuotaAudit(undefined): its default would query the staff bot.
      let pending = token ? cache.get(token) : undefined;
      if (!pending) {
        pending = token
          ? fetchLineQuotaAudit(token, now)
          : Promise.resolve(unavailableQuotaAudit(`${account.label} customer token not configured`, now));
        if (token) cache.set(token, pending);
      }
      const audit = await pending;
      return { ...account, audit, ...assessLineQuota(audit.snapshot) };
    })
  );
}
