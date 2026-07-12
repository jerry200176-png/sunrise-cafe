#!/usr/bin/env node
/**
 * Scan Gmail for recent Vercel / GitHub failure notifications.
 * Requires Cursor secrets: GMAIL_USER + app password (GMAIL_APP_PASSWORD or Gmail).
 */
import { ImapFlow } from "imapflow";

function resolveCredentials() {
  const user = (
    process.env.GMAIL_USER ??
    process.env.GMAIL_EMAIL ??
    process.env.GMAIL_ACCOUNT
  )?.trim();

  const rawPass =
    process.env.GMAIL_APP_PASSWORD ??
    process.env.Gmail ??
    process.env.GMAIL_PASSWORD;
  const pass = rawPass?.trim().replace(/\s/g, "");

  return { user, pass };
}

const { user, pass } = resolveCredentials();

if (!user || !pass) {
  const injected =
    process.env.CLOUD_AGENT_INJECTED_SECRET_NAMES?.split(",").map((s) =>
      s.trim()
    ) ?? [];
  const gmailSecrets = injected.filter((s) => /gmail/i.test(s));

  let hint = "Add GMAIL_USER (email) and GMAIL_APP_PASSWORD (16-char app password).";
  if (gmailSecrets.includes("Gmail") && !user) {
    hint =
      "Found Cursor secret「Gmail」(app password). Add GMAIL_USER with your Gmail address.";
  } else if (user && !pass) {
    hint =
      "GMAIL_USER is set but app password missing. Add GMAIL_APP_PASSWORD or rename secret to match.";
  }

  console.error(
    JSON.stringify({
      ok: false,
      error: "missing_credentials",
      need: ["GMAIL_USER", "GMAIL_APP_PASSWORD"],
      missing: [
        !user && "GMAIL_USER",
        !pass && "GMAIL_APP_PASSWORD",
      ].filter(Boolean),
      found_gmail_secrets: gmailSecrets,
      hint,
      setup: "https://myaccount.google.com/apppasswords",
      cursor:
        "https://cursor.com/dashboard/cloud-agents/environments/r/github.com/jerry200176-png/sunrise-cafe",
    })
  );
  process.exit(2);
}

const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
const client = new ImapFlow({
  host: "imap.gmail.com",
  port: 993,
  secure: true,
  auth: { user, pass },
  logger: false,
});

function looksRelevant(subject, from) {
  const text = `${subject} ${from}`.toLowerCase();
  return (
    /vercel|github|actions|deploy/i.test(text) &&
    /fail|error|cancel|denied|hobby|cron/i.test(text)
  );
}

try {
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  const results = [];

  try {
    const uids = await client.search({ since });
    const slice = uids.slice(-50);

    for await (const msg of client.fetch(slice, { envelope: true })) {
      const subject = msg.envelope?.subject ?? "";
      const from = msg.envelope?.from?.map((a) => a.address).join(", ") ?? "";
      if (!looksRelevant(subject, from)) continue;

      results.push({
        date: msg.envelope?.date?.toISOString?.() ?? null,
        from,
        subject,
      });
    }
  } finally {
    lock.release();
  }

  await client.logout();

  console.log(
    JSON.stringify(
      {
        ok: true,
        scanned_since: since.toISOString(),
        count: results.length,
        messages: results.reverse(),
      },
      null,
      2
    )
  );
} catch (err) {
  console.error(
    JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      hint: "Use a Google App Password, not your normal Gmail password",
    })
  );
  process.exit(1);
}
