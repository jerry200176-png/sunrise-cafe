# Payment Status Audit Log — Design Proposal (RC2 P1)

**Status:** Design only — **no migration yet**  
**Goal:** Trace every change to `reservations.is_deposit_paid` and related payment state

---

## Why two layers

| Layer | Purpose | When |
|-------|---------|------|
| **Structured logs** (`logPayment`) | Real-time ops, Vercel/Sentry | Phase A — immediate |
| **`payment_audit_log` table** | Queryable history, disputes, reports | Phase B — after design approval |

---

## Events to capture

| Event | Trigger | `before` → `after` |
|-------|---------|-------------------|
| `deposit.marked_paid` | Admin PATCH, approve API, LINE text webhook | `false` → `true` |
| `deposit.marked_unpaid` | Admin PATCH (rare reversal) | `true` → `false` |
| `deposit.note_updated` | `deposit_payment_note` change without status flip | note diff |
| `payment_event.approved` | Already logged — link `payment_event_id` | event `pending_review` → `approved` |
| `payment_event.rejected` | Reject API | event → `rejected` |
| `deposit.auto_released` | Deposit deadline cron | `status` → `cancelled`, unpaid |

**Not in scope:** CSV reconcile (read-only), migration-status probes.

---

## Actor types

| `actor_type` | Description | `actor_id` example |
|--------------|-------------|-------------------|
| `admin_session` | Back-office user via cookie | `"admin"` (no user table today) |
| `line_webhook_text` | Guest text keyword auto-mark | `line_user_id` |
| `line_webhook_image` | Screenshot → `payment_events` only | `line_user_id` |
| `admin_payment_review` | `/api/admin/payments/:id/approve` | `"admin"` |
| `cron_deposit_deadline` | Auto-release job | `"deposit-deadline"` |
| `system` | Internal batch / script | `"system"` |

---

## Proposed table schema (Phase B)

```sql
-- NOT YET APPLIED — design reference only
CREATE TABLE payment_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  payment_event_id UUID REFERENCES payment_events(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN (
    'admin_session', 'line_webhook_text', 'line_webhook_image',
    'admin_payment_review', 'cron_deposit_deadline', 'system'
  )),
  actor_ref TEXT,                    -- line_user_id, admin label, etc.
  action TEXT NOT NULL,              -- deposit.marked_paid, etc.
  before_state JSONB NOT NULL,       -- { is_deposit_paid, deposit_payment_note, status? }
  after_state JSONB NOT NULL,
  metadata JSONB,                    -- booking_code, raw_text snippet (truncated), ip hash
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_audit_log_reservation
  ON payment_audit_log(reservation_id, created_at DESC);

CREATE INDEX idx_payment_audit_log_action
  ON payment_audit_log(action, created_at DESC);

ALTER TABLE payment_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_all_payment_audit_log ON payment_audit_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

### Required fields (minimum viable row)

| Field | Required | Notes |
|-------|----------|-------|
| `reservation_id` | Yes | |
| `action` | Yes | Machine-readable |
| `actor_type` | Yes | |
| `before_state.is_deposit_paid` | Yes for deposit actions | |
| `after_state.is_deposit_paid` | Yes for deposit actions | |
| `created_at` | Yes | Default now() |
| `payment_event_id` | When applicable | Approve/reject flow |
| `metadata.booking_code` | Recommended | Denormalized for ops queries |
| `metadata.source` | Recommended | File/route name |

### PII handling

- Do **not** store full phone numbers in `metadata`
- Truncate `raw_text` / `deposit_payment_note` to 200 chars in audit rows
- Never store LINE tokens or bank account numbers

---

## Phase A — Log format (no migration)

Extend `PaymentLogAction`:

```typescript
| "deposit.marked_paid"
| "deposit.marked_unpaid"
| "deposit.note_updated"
```

Payload:

```json
{
  "domain": "payment",
  "action": "deposit.marked_paid",
  "reservation_id": "uuid",
  "booking_code": "ABC123",
  "actor_type": "admin_session",
  "before": { "is_deposit_paid": false },
  "after": { "is_deposit_paid": true }
}
```

### Insertion points (Phase A)

1. `src/app/api/reservations/[id]/route.ts` — when `patch.is_deposit_paid` defined
2. `src/app/api/webhooks/line/route.ts` — text auto-mark branch
3. `src/lib/payment-events-admin.ts` — `approvePaymentEvent`
4. `src/app/api/admin/reminders/deposit-deadline/route.ts` — auto-release loop

Helper: `logDepositStatusChange({ ... })` in `payment-log.ts` to avoid duplication.

---

## Retention strategy

| Store | Retention | Rationale |
|-------|-----------|-----------|
| Vercel Logs | ~7–30 days (plan-dependent) | Hot debugging |
| Sentry breadcrumbs | 90 days (if configured) | Error correlation |
| `payment_audit_log` (Phase B) | **24 months** | Disputes, tax season |
| Archival | Export rows >24mo to CSV in Supabase Storage | Optional; manual |

Purge job: monthly cron `DELETE FROM payment_audit_log WHERE created_at < now() - interval '24 months'` (Phase B only).

---

## Migration requirement summary

| Phase | DB migration | Deploy order |
|-------|--------------|--------------|
| A — structured logs | None | App only |
| B — audit table | `migration-payment-audit-log.sql` | **Migration first**, then app |

---

## Open decisions (need approval before Phase B)

1. Store audit rows synchronously on every change vs. async queue?
2. Add `admin_user_id` when multi-admin accounts exist?
3. Mirror approve actions into both `payment_events` and `payment_audit_log`?

**Recommendation:** Ship Phase A in RC2 P1; defer Phase B table until 30 days of log volume observed.
