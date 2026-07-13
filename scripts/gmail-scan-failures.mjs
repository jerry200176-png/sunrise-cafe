#!/usr/bin/env node
/**
 * Scan Gmail for deploy/CI failure signals (actionable only).
 * Requires: GMAIL_USER, GMAIL_APP_PASSWORD
 */
import { ImapFlow } from "imapflow";
import {
  normalizeCredential,
  classifyFailure,
  buildRecommendations,
  dedupeMessages,
  DEFAULT_REPO_FILTER,
  DEFAULT_SCAN_DAYS,
} from "./lib/gmail-ops.mjs";

const user = normalizeCredential(process.env.GMAIL_USER);
const pass = normalizeCredential(process.env.GMAIL_APP_PASSWORD);

if (!user || !pass) {
  console.error(
    JSON.stringify({
      ok: false,
      error: "missing_credentials",
      need: ["GMAIL_USER", "GMAIL_APP_PASSWORD"],
      setup: "https://myaccount.google.com/apppasswords",
    })
  );
  process.exit(2);
}

const scanDays = Number(process.env.GMAIL_SCAN_DAYS || DEFAULT_SCAN_DAYS);
const repoFilter = normalizeCredential(process.env.GMAIL_REPO_FILTER) || DEFAULT_REPO_FILTER;
const since = new Date(Date.now() - scanDays * 24 * 60 * 60 * 1000);

const client = new ImapFlow({
  host: "imap.gmail.com",
  port: 993,
  secure: true,
  auth: { user, pass },
  logger: false,
});

async function resolveShaParity() {
  try {
    const prodUrl = process.env.PROD_URL || "https://sunrise-cafe-six.vercel.app";
    const [ghRes, prodRes] = await Promise.all([
      fetch(`https://api.github.com/repos/jerry200176-png/sunrise-cafe/commits/main`, {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(12_000),
      }),
      fetch(`${prodUrl.replace(/\/$/, "")}/api/version`, {
        signal: AbortSignal.timeout(12_000),
      }),
    ]);
    if (!ghRes.ok || !prodRes.ok) return null;
    const gh = await ghRes.json();
    const prod = await prodRes.json();
    if (!gh.sha || !prod.commit) return null;
    return gh.sha === prod.commit;
  } catch {
    return null;
  }
}

try {
  const shaParity = await resolveShaParity();
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
      const meta = classifyFailure(subject, from, repoFilter);
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

  const deduped = dedupeMessages(
    results.sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime())
  );
  const actionable = deduped.filter((m) => {
    if (!m.date) return true;
    const ageH = (Date.now() - new Date(m.date).getTime()) / 3_600_000;
    if (m.kind === "github_ci") return ageH <= 48;
    if (m.kind === "vercel_production") return shaParity === false || ageH <= 48;
    return true;
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        scanned_since: since.toISOString(),
        scan_days: scanDays,
        repo_filter: repoFilter,
        inbox_messages_in_window: scanned,
        sha_parity: shaParity,
        raw_matches: results.length,
        deduped_count: deduped.length,
        actionable_count: actionable.length,
        by_kind: deduped.reduce((acc, m) => {
          acc[m.kind] = (acc[m.kind] ?? 0) + 1;
          return acc;
        }, {}),
        recommendations: buildRecommendations(deduped, { prodShaMatchesMain: shaParity }),
        actionable,
        historical: deduped.filter((m) => !actionable.includes(m)),
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
        ? "Use a Google App Password. Check GMAIL_USER has no internal spaces."
        : "IMAP connection failed",
    })
  );
  process.exit(1);
}
