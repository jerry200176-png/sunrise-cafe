export type LineNotificationPriority = "critical" | "actionable" | "informational";

export type LineQuotaSnapshot = {
  used: number | null;
  limit: number | null;
  limitType: "none" | "limited" | null;
  dailyPush: number | null;
  fetchedAt: string;
};

export type LineUsageDecision = {
  allowed: boolean;
  reason: "priority_exempt" | "no_budget" | "within_budget" | "monthly_budget" | "monthly_limit" | "surge";
  projectedUsage: number | null;
};

export type LineUsageBudget = {
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

/** Optional configuration: leaving the budget unset keeps existing delivery behavior. */
export function readLineUsageBudget(env: NodeJS.ProcessEnv = process.env): LineUsageBudget {
  return {
    monthlyBudget: positiveInteger(env.LINE_MONTHLY_MESSAGE_BUDGET),
    expectedDaily: positiveInteger(env.LINE_EXPECTED_DAILY_MESSAGES),
    surgeMultiplier: positiveNumber(env.LINE_USAGE_SURGE_MULTIPLIER, 3),
  };
}

function elapsedMonthDays(now: Date): number {
  return Math.max(1, now.getDate());
}

/**
 * Informational messages may be throttled; critical/actionable notifications
 * always remain eligible so quota protection cannot hide a human-required event.
 */
export function decideLineUsage(
  priority: LineNotificationPriority,
  snapshot: Pick<LineQuotaSnapshot, "used" | "limit"> | null,
  budget: LineUsageBudget,
  projectedMessages = 1,
  now = new Date()
): LineUsageDecision {
  if (priority !== "informational") {
    return { allowed: true, reason: "priority_exempt", projectedUsage: null };
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

async function getJson<T>(url: string, token: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Read-only LINE quota and today's Messaging API push consumption. */
export async function fetchLineQuotaSnapshot(
  token = process.env.LINE_CHANNEL_ACCESS_TOKEN,
  now = new Date()
): Promise<LineQuotaSnapshot> {
  if (!token) {
    return { used: null, limit: null, limitType: null, dailyPush: null, fetchedAt: now.toISOString() };
  }

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

  return {
    used: typeof consumption?.totalUsage === "number" ? consumption.totalUsage : null,
    limit: typeof quota?.value === "number" ? quota.value : null,
    limitType: quota?.type ?? null,
    dailyPush: delivery?.status === "ready" && typeof delivery.success === "number" ? delivery.success : null,
    fetchedAt: now.toISOString(),
  };
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
