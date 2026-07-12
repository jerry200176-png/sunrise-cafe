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
