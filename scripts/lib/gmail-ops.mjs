/**
 * Shared Gmail ops classification for scan + inbox triage.
 */

export const DEFAULT_REPO_FILTER = "sunrise-cafe";
export const DEFAULT_SCAN_DAYS = 7;
export const STALE_CI_HOURS = 72;

export function normalizeCredential(s) {
  return s?.trim().replace(/\s+/g, "") ?? "";
}

export function parseRepoFromSubject(subject) {
  const m = subject.match(/\[jerry200176-png\/([^\]]+)\]/i);
  return m?.[1]?.toLowerCase() ?? null;
}

export function parsePrFromSubject(subject) {
  const m = subject.match(/\(PR #(\d+)\)/i);
  return m ? Number(m[1]) : null;
}

/** Unique key for deduping failure notifications. */
export function failureDedupeKey(subject, from) {
  const repo = parseRepoFromSubject(subject) ?? "";
  const pr = parsePrFromSubject(subject) ?? "";
  const workflow = (subject.match(/Run failed:\s*([^-]+)/i)?.[1] ?? subject.match(/PR run failed:\s*([^-]+)/i)?.[1] ?? "other")
    .trim()
    .toLowerCase();
  const kind = from.includes("vercel.com")
    ? /\bpreview\b/i.test(subject)
      ? "vercel_preview"
      : "vercel_production"
    : "github_ci";
  return `${kind}|${repo}|${pr}|${workflow}`;
}

/**
 * Scan: actionable deploy/CI failure signals only.
 */
export function classifyFailure(subject, from, repoFilter = DEFAULT_REPO_FILTER) {
  const fromLower = from.toLowerCase();
  const subjectLower = subject.toLowerCase();
  const text = `${subjectLower} ${fromLower}`;

  if (fromLower.includes("notifications@vercel.com") && /\bfailed\b/i.test(subject)) {
    const kind = /\bpreview\b/i.test(subject)
      ? "vercel_preview"
      : /\bproduction\b/i.test(subject)
        ? "vercel_production"
        : "vercel_other";
    return {
      relevant: kind !== "vercel_preview",
      kind,
      severity: kind === "vercel_production" ? "high" : "medium",
      action: kind === "vercel_production" ? "verify_prod_sha" : "monitor_rate_limit",
    };
  }

  if (fromLower.includes("notifications@github.com")) {
    if (repoFilter && !text.includes(repoFilter)) {
      return { relevant: false };
    }

    if (
      /\b(run|workflow|check|ci)\b.*\bfail(ed|ure)?\b/i.test(text) ||
      /\bfail(ed|ure)?\b.*\b(run|workflow|check|ci)\b/i.test(text)
    ) {
      return {
        relevant: true,
        kind: "github_ci",
        severity: "high",
        action: "check_github_actions",
      };
    }
  }

  return { relevant: false };
}

/**
 * Triage: should this message leave the inbox?
 * Returns { archive, reason } — archive=true means mark read + remove from INBOX.
 */
export function triageInboxMessage(subject, from, dateIso, options = {}) {
  const {
    repoFilter = DEFAULT_REPO_FILTER,
    staleCiHours = STALE_CI_HOURS,
    now = Date.now(),
  } = options;

  const fromLower = from.toLowerCase();
  const ageHours = dateIso ? (now - new Date(dateIso).getTime()) / 3_600_000 : 0;

  if (fromLower.includes("notifications@vercel.com")) {
    if (/\bpreview\b/i.test(subject) && /\bfailed\b/i.test(subject)) {
      return { archive: true, reason: "vercel_preview_fail" };
    }
    return { archive: false, reason: "vercel_keep" };
  }

  if (!fromLower.includes("notifications@github.com")) {
    return { archive: false, reason: "non_ops_sender" };
  }

  const repo = parseRepoFromSubject(subject);
  if (repoFilter && repo && repo !== repoFilter) {
    return { archive: true, reason: "other_repo" };
  }

  if (/^re:/i.test(subject)) {
    return { archive: true, reason: "github_pr_thread" };
  }

  if (/chore\(deps\)|dependabot/i.test(subject)) {
    return { archive: true, reason: "dependabot" };
  }

  if (/\b(run|workflow|check|ci)\b.*\bfail(ed|ure)?\b/i.test(subject) || /\bfail(ed|ure)?\b/i.test(subject)) {
    if (ageHours > staleCiHours) {
      return { archive: true, reason: "stale_ci_failure" };
    }
    if (/\bpreview\b/i.test(subject)) {
      return { archive: true, reason: "preview_ci_noise" };
    }
    return { archive: false, reason: "recent_ci_failure" };
  }

  return { archive: true, reason: "github_low_signal" };
}

/**
 * @param {Array<{ kind?: string, date?: string, subject?: string, from?: string }>} messages
 * @param {{ prodShaMatchesMain?: boolean | null }} [opts]
 */
export function buildRecommendations(messages, { prodShaMatchesMain = null } = {}) {
  const recs = [];
  const prodFails = messages.filter((m) => m.kind === "vercel_production");
  const ciFails = messages.filter((m) => m.kind === "github_ci");
  const recentCi = ciFails.filter((m) => {
    if (!m.date) return false;
    return Date.now() - new Date(m.date).getTime() < 48 * 3_600_000;
  });

  if (prodFails.length > 0 && prodShaMatchesMain === false) {
    recs.push({
      priority: "high",
      signal: "vercel_production_failure",
      action: "Run deploy-gate; if mismatch persists, vercel deploy --prod.",
      count: prodFails.length,
    });
  }
  if (recentCi.length > 0) {
    recs.push({
      priority: "high",
      signal: "github_ci_failure_recent",
      action: "Inspect failed workflow in last 48h on sunrise-cafe.",
      count: recentCi.length,
    });
  }
  if (prodFails.length > 0 && prodShaMatchesMain === true) {
    recs.push({
      priority: "low",
      signal: "vercel_production_failure_resolved",
      action: "Historical prod fail emails — prod SHA now matches main.",
      count: prodFails.length,
    });
  }
  if (ciFails.length > recentCi.length) {
    recs.push({
      priority: "low",
      signal: "github_ci_failure_stale",
      action: `${ciFails.length - recentCi.length} CI fail emails older than 48h — safe to archive.`,
      count: ciFails.length - recentCi.length,
    });
  }
  if (recs.length === 0) {
    recs.push({
      priority: "low",
      signal: "no_actionable_failures",
      action: "No actionable deploy/CI failures. Run gmail:triage to archive PR thread noise.",
      count: 0,
    });
  }
  return recs;
}

export function dedupeMessages(messages) {
  const seen = new Set();
  const out = [];
  for (const m of messages) {
    const key = failureDedupeKey(m.subject, m.from);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}
