import { NextRequest } from "next/server";

/** Bearer token for machine-to-machine outcome pipeline (CTO scripts, Vercel cron). */
export function getCtoOutcomeSecret(): string | undefined {
  return process.env.CTO_OUTCOME_SECRET || process.env.CRON_SECRET;
}

export function isValidCtoBearer(request: NextRequest): boolean {
  const secret = getCtoOutcomeSecret();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}
