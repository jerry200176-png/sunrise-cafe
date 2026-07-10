/**
 * Lightweight growth experiment framework (server-side).
 */

export type ExperimentStatus = "draft" | "running" | "paused" | "completed";

export type ExperimentRecord = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  target_audience: string;
  status: ExperimentStatus;
  variants: string[];
  start_at: string | null;
  end_at: string | null;
};

export function parseVariants(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === "string" && v.length > 0);
  }
  return ["control", "treatment"];
}

export function isExperimentActive(exp: ExperimentRecord, now = new Date()): boolean {
  if (exp.status !== "running") return false;
  const t = now.getTime();
  if (exp.start_at && new Date(exp.start_at).getTime() > t) return false;
  if (exp.end_at && new Date(exp.end_at).getTime() < t) return false;
  return true;
}

/** Deterministic variant from anonymous session id */
export function assignVariant(
  experimentKey: string,
  sessionId: string,
  variants: string[]
): string {
  if (variants.length === 0) return "control";
  let hash = 0;
  const input = `${experimentKey}:${sessionId}`;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return variants[hash % variants.length];
}

export function experimentAnalyticsProps(
  experimentKey: string,
  variant: string
): { experiment: string; variant: string } {
  return { experiment: experimentKey, variant };
}
