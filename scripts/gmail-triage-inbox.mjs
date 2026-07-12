#!/usr/bin/env node
/**
 * Archive low-signal Gmail inbox noise (GitHub PR threads, preview fails, stale CI).
 *
 * Usage:
 *   node scripts/gmail-triage-inbox.mjs           # dry-run
 *   node scripts/gmail-triage-inbox.mjs --apply   # archive (mark read + remove INBOX)
 */
import { ImapFlow } from "imapflow";
import {
  normalizeCredential,
  triageInboxMessage,
  DEFAULT_REPO_FILTER,
  DEFAULT_SCAN_DAYS,
} from "./lib/gmail-ops.mjs";

const apply = process.argv.includes("--apply");
const user = normalizeCredential(process.env.GMAIL_USER);
const pass = normalizeCredential(process.env.GMAIL_APP_PASSWORD);

if (!user || !pass) {
  console.error(JSON.stringify({ ok: false, error: "missing_credentials" }));
  process.exit(2);
}

const scanDays = Number(process.env.GMAIL_SCAN_DAYS || DEFAULT_SCAN_DAYS);
const repoFilter = normalizeCredential(process.env.GMAIL_REPO_FILTER) || DEFAULT_REPO_FILTER;
const ARCHIVE_MAILBOX = process.env.GMAIL_ARCHIVE_MAILBOX || "[Gmail]/全部郵件";
const since = new Date(Date.now() - scanDays * 24 * 60 * 60 * 1000);

const client = new ImapFlow({
  host: "imap.gmail.com",
  port: 993,
  secure: true,
  auth: { user, pass },
  logger: false,
});

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

try {
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  const toArchive = [];
  const byReason = {};
  let scanned = 0;
  let archived = 0;

  try {
    const uids = await client.search({ since });
    scanned = uids.length;

    for await (const msg of client.fetch(uids, { envelope: true, uid: true })) {
      const subject = msg.envelope?.subject ?? "";
      const from = msg.envelope?.from?.map((a) => a.address).join(", ") ?? "";
      const date = msg.envelope?.date?.toISOString?.() ?? null;
      const triage = triageInboxMessage(subject, from, date, { repoFilter });
      if (!triage.archive) continue;
      toArchive.push(msg.uid);
      byReason[triage.reason] = (byReason[triage.reason] ?? 0) + 1;
    }

    if (apply && toArchive.length > 0) {
      for (const batch of chunk(toArchive, 50)) {
        const range = batch.map(String).join(",");
        await client.messageFlagsAdd(range, ["\\Seen"], { uid: true });
        const moved = await client.messageMove(range, ARCHIVE_MAILBOX, { uid: true });
        if (moved?.uidMap?.size) {
          archived += moved.uidMap.size;
        } else {
          archived += batch.length;
        }
      }
    }
  } finally {
    lock.release();
  }

  await client.logout();

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: apply ? "apply" : "dry-run",
        scanned_since: since.toISOString(),
        scan_days: scanDays,
        inbox_messages_in_window: scanned,
        archive_mailbox: ARCHIVE_MAILBOX,
        would_archive: toArchive.length,
        archived,
        by_reason: byReason,
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
    })
  );
  process.exit(1);
}
