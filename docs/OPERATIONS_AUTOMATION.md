# Operations Automation Audit

**Phase 4** · Daily operator workflows

## Automated (Cron — Taipei 20:00 unless noted)

| Job | Path | Action |
|-----|------|--------|
| Tomorrow LINE digest | `/api/admin/reminders/send-line` | Push tomorrow bookings to branch LINE groups |
| D-7 guest reminder | `/api/admin/reminders/send-line-7d` | Flex message to guests with `line_user_id` |
| Deposit deadline | `/api/admin/reminders/deposit-deadline` | Remind → auto-cancel unpaid → `notifyWaitlist()` |
| No-show scan (advisory) | `/api/admin/reminders/no-show-scan` | Taipei 22:00 — list probable no-shows, no auto-cancel |

## Event-driven

| Trigger | Action |
|---------|--------|
| Guest/admin cancel | `notifyWaitlist()` — first matching waitlist entry |
| Reschedule freeing slot | Same waitlist notification |
| LINE payment keyword/image | `payment_events` + optional auto-mark (text) |
| Deposit paid (approved) | Group LINE notify |

## Manual (candidates for future automation)

| Task | Current | Recommendation |
|------|---------|----------------|
| Payment screenshot review | `/admin/payments` | Keep manual — high trust |
| Check-in / no-show | Reservation list status | Use no-show scan + staff action |
| Google review invite | `review_invited_at` field | Cron when `google_review_url` set |
| Branch comparison | `/admin/insights` | Now automated via BI API |

## Reducing daily manual work

1. Start day on **儀表板** + **商業洞察** (today revenue, pending deposits, waitlist)
2. Use **付款審核** batch only for pending screenshots
3. Run **no-show scan** output to follow up before releasing slots
4. Deposit auto-cancel already handles unpaid release + waitlist

## Monitoring

- Cron failures: Vercel Functions logs
- LINE failures: `[waitlist]`, `[line]` console + Sentry
- Deposit job: `docs/MIGRATIONS.md` + ADR-007
