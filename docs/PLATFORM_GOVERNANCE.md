# Platform Governance — Architecture Map & Domain Boundaries

**Sunrise Cafe** · Phase 6 governance reference for engineers and AI agents.

---

## Architecture Map

```
                         ┌─────────────────────────────────────┐
                         │           Clients                    │
                         │  Guest Web · Admin Web · LINE · Cron │
                         └──────────────────┬──────────────────┘
                                            │
                         ┌──────────────────▼──────────────────┐
                         │     Next.js 15 (Vercel Monolith)     │
                         │  middleware.ts (auth, rate limit)    │
                         └──────────────────┬──────────────────┘
              ┌────────────────────────────┼────────────────────────────┐
              ▼                            ▼                            ▼
     ┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
     │   Presentation   │         │   API Routes     │         │   Automation     │
     │ src/app/book     │         │ src/app/api/*    │         │ vercel.json      │
     │ src/app/admin    │         │ (thin handlers)  │         │ crons → lib      │
     │ src/app/order    │         └────────┬─────────┘         └────────┬─────────┘
     └────────┬─────────┘                  │                            │
              │                            ▼                            │
              │                 ┌─────────────────────┐                   │
              └────────────────►│    Domain Libs       │◄──────────────────┘
                                │ src/lib/<domain>.ts  │
                                └──────────┬──────────┘
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              ▼                            ▼                            ▼
     ┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
     │ Data Access      │         │ Integrations     │         │ Cross-cutting    │
     │ supabase-admin   │         │ line.ts          │         │ datetime.ts      │
     │ supabase-fetch   │         │ line-notify.ts   │         │ rate-limit.ts    │
     │ analytics-server │         │ resend (email)   │         │ schema-governance│
     └────────┬─────────┘         └─────────────────┘         └─────────────────┘
              │
              ▼
     ┌─────────────────┐         ┌─────────────────┐
     │ Supabase PG      │         │ External         │
     │ + RLS            │         │ LINE · Upstash   │
     └─────────────────┘         └─────────────────┘

     Off-Vercel: print-bridge/ (store-local printing)
```

---

## Domain Boundaries

| Domain | Owns | Primary libs | API prefix | Must NOT own |
|--------|------|--------------|------------|--------------|
| **Booking** | Reservations, slots, pricing, cancel | `booking-utils`, `slot-conflict`, `reservation-cancel`, `guest-auth` | `/api/reservations`, `/api/availability`, `/api/cancel-booking` | LINE push copy, payment audit |
| **Catalog** | Branches, rooms, settings | `supabase-admin` (catalog fns) | `/api/branches`, `/api/rooms`, `/api/settings` | Reservation business rules |
| **Payments** | Deposit state, keywords, audit | `payment-*`, `deposit-deadline` | `/api/webhooks/line`, `/api/admin/payments` | Guest booking wizard UI |
| **LINE** | Dual-bot messaging, OAuth | `line.ts`, `line-notify.ts`, `line-oauth`, `line-flex` | `/api/auth/line`, webhook | Direct DB schema changes |
| **Waitlist** | Demand recovery | `waitlist.ts` | `/api/waitlist` | Payment approval |
| **Ordering** | QR menu, kitchen orders | (routes + supabase) | `/api/orders`, `/order/*` | Booking overlap logic |
| **Analytics** | Funnel events (no PII) | `analytics*`, `analytics-events` | `/api/analytics` | Customer PII storage |
| **BI / Ops** | KPIs, DQ, exceptions, demand | `business-kpis`, `data-quality`, `ops-exceptions`, `demand-signals`, `morning-summary-context` | `/api/admin/bi`, `/api/admin/ops`, `/api/admin/data-quality` | LINE credential storage |
| **Growth** | Experiments, retention | `experiments*`, `customer-retention` | `/api/admin/experiments`, `/api/experiments` | Dynamic pricing |
| **Platform** | Auth, schema, env governance | `admin-auth`, `schema-governance`, middleware | `/api/admin/schema` | Business KPI definitions |

---

## Dependency Rules

### Allowed

```
app/route  →  lib/domain  →  lib/data-access (supabase-admin)
app/route  →  lib/cross-cutting (datetime, rate-limit)
lib/domain →  lib/cross-cutting
lib/domain →  lib/data-access
```

### Forbidden

| Rule | Rationale |
|------|-----------|
| `src/lib/*` → `src/app/*` | Libs must not depend on UI or route handlers |
| `booking` → `ordering` (direct) | Separate product surfaces; share only via `supabase-admin` or types |
| `analytics` → store PII | Privacy boundary |
| `line-notify` → `line.ts` (guest bot) | Keep dual-channel separation |
| Routes → raw Supabase when a lib function exists | Prefer `supabase-admin` or domain module |
| New business logic inline in routes > ~30 lines | Extract to `src/lib/` |

### Tightly Coupled Modules (watch list)

| Module | Coupling risk | Direction |
|--------|---------------|-----------|
| `supabase-admin.ts` | Hub for all DB | Split by domain when next major touch |
| `webhooks/line/route.ts` | LINE + payments + DB | Keep; document as integration boundary |
| `reservations/[id]/route.ts` | Booking + LINE + waitlist + payments | Extract LINE triggers to `reservation-notify.ts` (future) |
| `deposit-deadline/route.ts` | Cron orchestration | Acceptable if lib holds logic |

### Dangerous Dependencies

- **`schema.sql` DROP TABLE** — never run in production; migrations only
- **Anon key in server paths without RLS** — always service role for admin
- **Client-supplied `line_user_id`** — only httpOnly cookie (see `LINE_OAUTH_SECURITY.md`)
- **Client-supplied `status` / `total_price` on guest POST** — server must compute (P0)

---

## Ownership Model

| Domain | DRI (default) | Reviewers | Escalation |
|--------|---------------|-----------|------------|
| Booking & catalog | Platform engineer | Operator (UX) | Double-booking / slot bugs |
| Payments & LINE | Platform engineer | Operator (copy/accounts) | Wrong deposit marking |
| BI / Ops / Growth | Platform engineer | Operator (KPI meaning) | Misleading dashboards |
| Ordering & print-bridge | Platform engineer | Store staff | Kitchen print failures |
| Database & migrations | Platform engineer | — | Any prod migration |
| Security & auth | Platform engineer | — | Any auth bypass report |
| Docs & governance | Any contributor | Platform engineer | ADR conflicts |

**AI agents:** Treat as contributors under `docs/AI_AGENT_GOVERNANCE.md`; human review required for auth, migrations, and payment state changes.

---

## Governance Cadence

| Activity | Frequency | Artifact |
|----------|-----------|----------|
| Migration manifest sync | Each new migration | `supabase/migrations.manifest.json` |
| Schema drift check | Deploy + weekly | `/api/admin/schema/status` |
| Security checklist | Quarterly | `SECURITY_REVIEW_CHECKLIST.md` |
| Technical debt review | Quarterly | `TECHNICAL_DEBT_REVIEW.md` |
| ADR reconciliation | Quarterly | `DECISIONS.md` |
| Multi-branch scale review | At 10+ branches | `MULTI_BRANCH_SCALE.md` |

---

## Related

- `docs/ARCHITECTURE.md` — system overview
- `docs/PHASE6_ARCHITECTURE.md` — Phase 6 roadmap
- `docs/AI_AGENT_GOVERNANCE.md` — agent rules
