# Journey Selection + OSS Research Brief — Sunrise Cafe (Phase 2)

**Issue:** [#239](https://github.com/jerry200176-png/sunrise-cafe/issues/239)  
**Selected journey:** **Guest booking flow** (`/book` — branch → date → room → slot → form → success/deposit)  
**Research mode:** read-only · **No product redesign PR recommended**

---

## Journey selection

### Selected: **Booking flow** (`/book`)

| Criterion | Evidence |
|-----------|----------|
| Usage / business impact | CTO_STRATEGY §2.1 — Discover + Book rated **High / A−**; core revenue path |
| GitHub / PR density | **PR #200** exclusively targets booking data fetches across `/book`, query, waitlist, payment modal |
| Mobile-first (`DESIGN.md`) | `CustomerShell`, `BookingStepProgress`, `.pb-sticky-form`, safe-area utilities; 5-step wizard is phone-primary (`max-w-md` → `max-w-xl`) |
| Bug / friction density | ENGINEERING_ASSESSMENT — design split on booking; no fetch timeout on `main` (infinite hang risk); `design:audit` S5 blue toggle in form; waitlist CTA exists but waitlist pages off-contract |
| Operational importance | Feeds deposit + LINE reminder funnel; outcome metrics use `booking_started` denominators |

### Not selected (brief rationale)

| Journey | Why not primary |
|---------|-----------------|
| Booking query | Strong post-booking UX; lower abandonment than mid-wizard hang |
| Deposit completion | Sub-step of booking + query; Stripe/LINE Pay gated by founder (#211 FD-5) |
| Reservation confirmation | `/book/confirm-visit` — lower traffic; legacy shell |
| Staff reservation | Operator journey; DESIGN.md allows admin stone/amber |
| Payment review | Admin `/admin/payments` — operator bottleneck but not guest Phase 2 product pick |
| LINE reminder status | Delivery semantics matter but tied to cron/LINE infra (#219), not wizard UX |

---

## Required research brief

### User problem

Guests booking a private room on mobile need to **complete a five-step wizard without getting stuck** when availability APIs are slow or fail. Today, client-side fetches on `main` have **no unified timeout**; users can wait indefinitely on branch/room/slot loads. Separately, the wizard **mixes legacy gray/amber controls with Warm Artisan shell**, and one form control violates brand audit (blue toggle).

### Current evidence

| Source | Finding |
|--------|---------|
| PR #200 | Documents all booking-related fetches; proposes 15s `AbortController` + Chinese error copy |
| `src/app/book/page.tsx` | `slotsFetchState`, skeleton loading, retry buttons, `EmptyState` + waitlist link; draft restore 6h |
| `design:audit` 2026-07-19 | S3/S5 hits in booking form (`AddReservationForm` patterns on page) |
| ENGINEERING_ASSESSMENT | "Design system split"; P1-3 progress indicator **fixed** (#221) |
| `customer-ui-contract.md` | Shell + step progress contract with a11y tests |
| E2E | Playwright booking smoke passes on PR #200 CI run |

### Sources reviewed (≥3 mature OSS)

| # | Project | License | Relevance | Maintenance |
|---|---------|---------|-----------|-------------|
| 1 | [alextselegidis/easyappointments](https://github.com/alextselegidis/easyappointments) (~4k★) | GPL-3.0 | Multi-step booking, mobile calendar layout, email confirmation states | Active 2025–2026 changelog |
| 2 | [tastyigniter/ti-ext-reservation](https://github.com/tastyigniter/ti-ext-reservation) (+ core [TastyIgniter](https://github.com/tastyigniter/TastyIgniter)) | MIT | Restaurant table booking, slot capacity, status workflow, confirmation emails | Mature extension on active 4.x core |
| 3 | [karanshukla/openresto](https://github.com/karanshukla/openresto) | MIT | Cafe/restaurant-focused, mobile-friendly guest UI, real-time holds, multi-location | New but focused domain fit |
| 4 | [mighty840/kitchenasty](https://github.com/mighty840/kitchenasty) | MIT | Reservation + ordering monorepo, documented API, 350+ tests | Active docs + CI |

*Also scanned:* SeatKit (Apache-2.0, early frontend), Kouzina (GPL-style PHP demo, dark theme — poor brand fit).

### Patterns observed

| Pattern | Where seen |
|---------|------------|
| Explicit **loading / empty / error** slot panels | Easy!Appointments mobile calendar; OpenResto hold states; Sunrise `slotPanelMode` + skeleton |
| **Retry without losing form context** | KitchenAsty API error handling docs; Sunrise draft in `booking-draft.ts` |
| **Step wizard with back navigation** | TastyIgniter reservation widget; Sunrise `BookingStepProgress` + `goToStep` |
| **Timeout-bound fetches** | Common in production SPAs; **missing on Sunrise `main`** — PR #200 adds |
| **Deposit shown before commit** | TastyIgniter settings; Sunrise `getDepositAmount` on slot step |
| **Waitlist when sold out** | OpenResto pause/book; Sunrise `EmptyState` → waitlist href (waitlist page itself off-contract) |

### Pattern selected

**Reliability-first booking wizard contract:**

1. **Bounded fetch** (15s default, 20s submit) with user-visible recoverable error — align with PR #200, not new UX chrome.
2. **Keep** existing step model + `BookingStepProgress` — do not restructure IA (Hallmark redesign explicitly rejected in HALLMARK_ADOPTION).
3. **Incremental token fix** on guest controls (blue → caramel) when touching form — single-file, audit-driven.
4. **Defer** waitlist shell migration until after #200 merge (same fetch helper).

### Patterns rejected

| Pattern | Reason |
|---------|--------|
| Hallmark default theme / full redesign | Violates DESIGN.md SSOT; HALLMARK_ADOPTION §2 |
| Import TastyIgniter / Easy!Appointments UI wholesale | PHP stacks, wrong architecture; GPL/MIT code copy unnecessary |
| Kouzina dark theme | Conflicts with Warm Artisan Editorial |
| Replace wizard with single-page calendar (Easy!Appointments admin style) | High regression risk; current funnel validated (#181 OPS-004b) |
| Stars-based adoption of OpenResto | Too new for production copy; ideas only |

### Why it fits this domain

Sunrise is a **Taiwan private-room café** with LINE deposit workflow — not generic appointments. Patterns needed are **slot scarcity, deposit clarity, mobile thumb reach, and hang recovery**, not restaurant POS breadth. OpenResto/KitchenAsty validate room/slot mental models; Easy!Appointments validates mobile step/responsive filters; TastyIgniter validates reservation status language — all mappable without importing code.

### License impact

| Source | Impact |
|--------|--------|
| MIT (OpenResto, KitchenAsty, TastyIgniter ext) | Patterns and technique extraction only — **no copy-paste UI blocks required** |
| GPL-3.0 (Easy!Appointments) | **Do not import code** — interaction ideas only |
| Apache-2.0 (SeatKit) | Optional future reference for staff timeline — out of guest journey scope |

No attribution file required for pattern-level research. Hallmark already attributed in DESIGN.md §11.

### Engineering impact

| Change | Effort | Risk |
|--------|--------|------|
| Merge PR #200 (`fetch-with-timeout.ts`) | S — conflict resolution | Low — isolated helper |
| Caramel toggle instead of blue (booking form) | S | Low |
| Waitlist → `CustomerShell` | M | Medium — separate PR after timeout |
| Full token pass gray→ink/caramel on steps | M–L | Medium — visual churn without metric proof |

**Parallel capacity note:** Reliability track owns live outcomes on `chore/task-239`; product track should **close #200 first**, not a parallel redesign PR.

### Expected outcome

- P95 guest-visible **hang duration capped at 15s** with actionable retry.
- No increase in abandoned drafts due to silent failures.
- `design:audit` S5 clean on guest booking form (post small token fix).
- Funnel metrics (`/api/booking-funnel`) continue to receive step events — no IA change.

### Validation method

1. **Automated:** Playwright booking + query smoke; Vitest for `fetch-with-timeout`; optional `design:audit --strict` on guest paths.
2. **Manual mobile:** Chrome DevTools slow 3G + offline — confirm error banner + retry restores slot grid.
3. **Production:** Compare `booking_started` vs `booking_completed` 7d before/after #200 deploy (outcome pipeline — requires Part 1 live path).
4. **Not sufficient alone:** Screenshot diff / Hallmark score without funnel delta.

---

## Product journey subsection — recommendation

### **FAIL** (no new UI redesign PR this phase)

| Gate | Status |
|------|--------|
| Sufficient evidence for **structural** UX change | **No** — primary pain is **reliability** (hang), already addressed by #200 |
| Reliability track capacity | **Occupied** — live outcomes Part 1 in flight |
| Measurable baseline for redesign ROI | **Missing** — no production analytics tying gray/amber to abandonment |
| Design compliance gap | **Partial** — audit hits are small; not a journey rewrite |

**Honest path:** Ship **#200** + optional **token fix PR** (blue toggle). Revisit wizard visual unification when outcome metrics show post-timeout conversion and `design:audit --strict` passes.

---

## 14 UX investigation questions (booking flow)

Evidence tags: **[C]** code · **[D]** doc · **[P]** PR/issue · **[O]** OSS comparison

1. **使用者角色是誰？**  
   First-time or returning **guests** booking a private room on phone (~90% mobile-first per DESIGN.md spacing). **[C]** `CustomerShell` guest shell · **[D]** CTO_STRATEGY guest journey table

2. **要完成的 job-to-be-done 是什麼？**  
   Select branch/date/room/time, enter party details, accept deposit policy, submit reservation (optional Stripe modal). **[C]** `BOOKING_STEP_ORDER` · **[D]** CTO_STRATEGY "Book + see price"

3. **最常卡在哪一步？**  
   **Slot / availability fetch** — network hang without timeout on `main`; room list load when changing branch/date. **[P]** #200 scope table · **[C]** `slotsFetchState`, `availabilityRetry`

4. **哪個資訊需要思考最久？**  
   **Duration + deposit estimate** on slot step (pricing, weekend rules, deposit instruction block). **[C]** `getDepositAmount`, amber deposit notice · **[O]** TastyIgniter lead-time/settings

5. **哪個動作最容易犯錯？**  
   **Phone format / guest count / terms checkbox** — field-level errors with scroll-to-field. **[C]** `fieldErrors`, `scrollToField` · Less: date reselection after branch change (guarded by `goToStep`)

6. **哪些文字是工程術語？**  
   Mostly plain Chinese/EN/JA via i18n; risk terms: "Stripe", raw API errors if unhandled. **[C]** `translations.ts` · **[D]** customer-ui-contract i18n test requirement

7. **手機是否能完整操作？**  
   **Yes** — sticky form padding, step panel focus, 4-col slot grid. **[C]** `.pb-sticky-form`, `focusStepPanel` · **[D]** DESIGN.md touch ≥44px · **[D]** #176 QA safe-area

8. **loading 是否清楚？**  
   **Partial pass** — slot step has skeleton + `aria-busy`; branch/room steps use generic `loading` flag with less consistent skeleton. **[C]** lines 722, 867–876 · **[O]** Easy!Appointments mobile loading polish (changelog)

9. **empty state 是否有下一步？**  
   **Yes on slot step** — `EmptyState` + waitlist CTA. Branch empty is text-only (weaker). **[C]** `EmptyState` + `buildWaitlistHref` · **[D]** customer-ui-contract §2.3

10. **error state 是否可恢复？**  
    **Partial on `main`** — retry buttons for slots/availability; **no timeout** until #200. Submit errors use `role="alert"` banner. **[C]** retry handlers · **[P]** #200 AbortError handling

11. **partial data 是否會誤導？**  
    **`slotsFetchState` distinguishes** loading / ready / error / empty — zero slots ≠ error. Room availability badge uses separate fetch. **[C]** `slotPanelMode` · **[D]** ENGINEERING_ASSESSMENT double-book race (server-side concern)

12. **destructive action 是否可理解？**  
    Limited destructiveness in wizard; **step back** clears downstream selections via `goToStep`. Cancel is post-booking (query flow). **[C]** `goToStep` reset logic

13. **成功後是否知道系統做了什麼？**  
    **Yes** — redirect to `/book/success` with code copy, deposit instructions, query link. **[C]** `saveBookingSuccessMeta` · **[D]** ENGINEERING_ASSESSMENT success path

14. **是否需要離頁、詢問工程師或猜測？**  
    **Yes today on hang** — user must guess if app is broken (no timeout). Deposit policy requires reading multi-line notice — acceptable but dense. **[P]** #200 motivation · **[D]** ENGINEERING_ASSESSMENT debug link to `/api/booking-health` on landing (guest confusion risk, out of `/book` scope)

---

## Cross-links

- Design SSOT: [`DESIGN_SSOT_RECOVERY.md`](./DESIGN_SSOT_RECOVERY.md)
- Portfolio picks: [`GITHUB_PORTFOLIO_PICKS.md`](./GITHUB_PORTFOLIO_PICKS.md)
- Active product close-first: **PR #200**
- Active reliability: **#239 Part 1 live outcomes** on `chore/task-239`

---

*Phase 2 Task C · Journey + OSS brief · read-only research*
