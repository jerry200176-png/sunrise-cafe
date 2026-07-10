"use client";

import { experimentAnalyticsProps } from "@/lib/experiments";

export type ActiveExperiment = {
  key: string;
  variant: string;
};

const COOKIE_PREFIX = "exp_";

export function getExperimentAssignments(): ActiveExperiment[] {
  if (typeof document === "undefined") return [];
  const out: ActiveExperiment[] = [];
  for (const part of document.cookie.split(";")) {
    const [rawKey, rawVal] = part.trim().split("=");
    if (!rawKey?.startsWith(COOKIE_PREFIX) || !rawVal) continue;
    out.push({
      key: decodeURIComponent(rawKey.slice(COOKIE_PREFIX.length)),
      variant: decodeURIComponent(rawVal),
    });
  }
  return out;
}

export function setExperimentCookie(key: string, variant: string, maxAgeSec = 604800) {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE_PREFIX}${encodeURIComponent(key)}=${encodeURIComponent(variant)}; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax${secure}`;
}

export function analyticsExperimentProps(): Record<string, string> {
  const assignments = getExperimentAssignments();
  if (assignments.length === 0) return {};
  const first = assignments[0];
  return experimentAnalyticsProps(first.key, first.variant);
}

export async function loadActiveExperiments(sessionId?: string): Promise<ActiveExperiment[]> {
  try {
    const q = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
    const res = await fetch(`/api/experiments/active${q}`);
    if (!res.ok) return getExperimentAssignments();
    const data = (await res.json()) as { assignments?: ActiveExperiment[] };
    const assignments = data.assignments ?? [];
    for (const a of assignments) {
      setExperimentCookie(a.key, a.variant);
    }
    return assignments;
  } catch {
    return getExperimentAssignments();
  }
}
