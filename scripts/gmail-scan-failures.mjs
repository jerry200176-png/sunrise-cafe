#!/usr/bin/env node
/**
 * Scan Gmail for recent Vercel / GitHub failure notifications.
 * Requires Cursor secrets: GMAIL_USER, GMAIL_APP_PASSWORD (Google App Password).
 */
import { ImapFlow } from "imapflow";

// Strip all whitespace — Google app passwords are often pasted as "xxxx xxxx xxxx xxxx",
// and GMAIL_USER may accidentally include a space before "@".
const normalize = (s) => s?.trim().replace(/\s+/g, "") ?? "";
const user = normalize(process.env.GMAIL_USER);
const pass = normalize(process.env.GMAIL_APP_PASSWORD);

if (!user || !pass) {
  console.error(
    JSON.stringify({
      ok: false,
      error: "missing_credentials",
      need: ["GMAIL_USER", "GMAIL_APP_PASSWORD"],
      setup: "https://myaccount.google.com/apppasswords",
      cursor:
        "https://cursor.com/dashboard/cloud-agents → Environments → sunrise-cafe → Secrets",
    })
  );
  process.exit(2);
}

const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
const repoFilter = normalize(process.env.GMAIL_REPO_FILTER) || "sunrise-cafe";
const client = new ImapFlow({
  host: "imap.gmail.com",
  port: 993,
  secure: true,
  auth: { user, pass },
  logger: false,
});

/** Classify deploy/CI failure mail; avoid PR thread noise like "field errors". */
function classify(subject, from) {
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
      relevant: true,
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

    // PR discussion "Re:" threads — only when explicit deploy/CI failure wording
    if (
      /^re:/i.test(subject) &&
      /\b(fail(ed|ure)?|cancel(led)?|denied)\b/i.test(subject) &&
      /\b(deploy|vercel|actions|workflow|cron)\b/i.test(text)
    ) {
      return {
        relevant: true,
        kind: "github_thread",
        severity: "medium",
        action: "review_pr_checks",
      };
    }
  }

  return { relevant: false };
}

function buildRecommendations(messages) {
  const recs = [];
  const prodFails = messages.filter((m) => m.kind === "vercel_production");
  const previewFails = messages.filter((m) => m.kind === "vercel_preview");
  const ciFails = messages.filter((m) => m.kind === "github_ci");

  if (prodFails.length > 0) {
    recs.push({
      priority: "high",
      signal: "vercel_production_failure",
      action:
        "Run deploy-gate: curl /api/version vs origin/main. If mismatch >30m, manual vercel deploy --prod.",
      count: prodFails.length,
    });
  }
  if (previewFails.length >= 3) {
    recs.push({
      priority: "medium",
      signal: "vercel_preview_rate_limit",
      action:
        "Hobby deploy quota — rely on GitHub Actions CI (already green). Preview checks may fail ~24h; prod unaffected.",
      count: previewFails.length,
    });
  }
  if (ciFails.length > 0) {
    recs.push({
      priority: "high",
      signal: "github_ci_failure",
      action: "Inspect failed workflow on main or open PRs; fix before merge.",
      count: ciFails.length,
    });
  }
  if (recs.length === 0) {
    recs.push({
      priority: "low",
      signal: "no_actionable_failures",
      action: "No deploy/CI failures in scan window. Customer mail not included in this scan.",
      count: 0,
    });
  }
  return recs;
}

try {
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  const results = [];
  let scanned = 0;

  try {
    const uids = await client.search({ since });
    scanned = uids.length;

    for await (const msg of client.fetch(uids, { envelope: true })) {
      const subject = msg.envelope?.subject ?? "";
      const from = msg.envelope?.from?.map((a) => a.address).join(", ") ?? "";
      const meta = classify(subject, from);
      if (!meta.relevant) continue;

      results.push({
        date: msg.envelope?.date?.toISOString?.() ?? null,
        from,
        subject,
        kind: meta.kind,
        severity: meta.severity,
        action: meta.action,
      });
    }
  } finally {
    lock.release();
  }

  await client.logout();

  const messages = results.sort(
    (a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime()
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        scanned_since: since.toISOString(),
        repo_filter: repoFilter || null,
        inbox_messages_in_window: scanned,
        count: messages.length,
        by_kind: messages.reduce((acc, m) => {
          acc[m.kind] = (acc[m.kind] ?? 0) + 1;
          return acc;
        }, {}),
        recommendations: buildRecommendations(messages),
        messages,
      },
      null,
      2
    )
  );
} catch (err) {
  const authFailed =
    err &&
    typeof err === "object" &&
    "authenticationFailed" in err &&
    err.authenticationFailed;
  console.error(
    JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code:
        err && typeof err === "object" && "serverResponseCode" in err
          ? err.serverResponseCode
          : undefined,
      hint: authFailed
        ? "Use a Google App Password (not login password). Check GMAIL_USER has no spaces and the 16-char app password is correct."
        : "IMAP connection failed — retry or check network",
    })
  );
  process.exit(1);
}
