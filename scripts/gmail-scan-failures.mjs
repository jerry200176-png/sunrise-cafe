#!/usr/bin/env node
/**
 * Scan Gmail for recent Vercel / GitHub failure notifications.
 * Requires Cursor secrets: GMAIL_USER, GMAIL_APP_PASSWORD (Google App Password).
 */
import { ImapFlow } from "imapflow";

const user = process.env.GMAIL_USER?.trim();
const pass = process.env.GMAIL_APP_PASSWORD?.trim();

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
const client = new ImapFlow({
  host: "imap.gmail.com",
  port: 993,
  secure: true,
  auth: { user, pass },
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
