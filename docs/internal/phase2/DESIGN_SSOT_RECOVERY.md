# Design SSOT Recovery — Sunrise Cafe (Phase 2)

**Worktree:** `chore/task-239` · **Issue:** [#239](https://github.com/jerry200176-png/sunrise-cafe/issues/239)  
**Recovery date:** 2026-07-19  
**Canonical authority:** repo-root [`DESIGN.md`](../../../DESIGN.md) — **Warm Artisan Editorial**

---

## Executive summary

| Item | Finding |
|------|---------|
| Canonical design file | **`DESIGN.md`** (repo root) — only design-system SSOT in tree |
| Lowercase `design.md` | **Absent** — not created; all active docs already link to `DESIGN.md` |
| Parallel systems | **None found** — no `design-v2.md`, `new-design.md`, or duplicate token files |
| Enforcement | `npm run design:audit` (non-strict by default); Hallmark adoption doc is supporting, not competing |
| Migration status | Guest booking **core path migrated**; waitlist / confirm-visit **legacy shell**; admin **intentionally stone/amber** |

**Recommendation:** Keep **`DESIGN.md`** as sole authority. Do **not** add a lowercase pointer unless external tooling hard-requires `design.md` — current links are consistent on uppercase.

---

## 1. Canonical file

| Field | Value |
|-------|-------|
| Path | [`DESIGN.md`](../../../DESIGN.md) |
| Brand | Warm Artisan Editorial — paper / ink / caramel, Fraunces + Noto |
| Last meaningful change | `195c8de` — feat: 首頁與設計系統改版 (#45); §11 Hallmark audit added in follow-on commits |
| Code mirror | [`src/app/globals.css`](../../../src/app/globals.css) (CSS vars + `.grain`, `.rise`, safe-area utilities) |
| Tailwind mapping | [`tailwind.config.ts`](../../../tailwind.config.ts) — `paper`, `ink`, `caramel-*` tokens |

Phase 2 CEO contract references `design.md` (lowercase). **Repo convention is `DESIGN.md`.** Treat uppercase as canonical; update downstream automation labels, not the file name.

---

## 2. Supporting docs (not superseded)

| Document | Role | Relationship to SSOT |
|----------|------|---------------------|
| [`docs/internal/design/HALLMARK_ADOPTION.md`](../design/HALLMARK_ADOPTION.md) | Hallmark **audit methodology** adoption decision | Points to `DESIGN.md`; does not define colors/typography |
| [`docs/customer-ui-contract.md`](../../customer-ui-contract.md) | **Component contract** for `CustomerShell`, `BookingStepProgress`, `EmptyState` | Explicitly **not** a design system; tokens → `DESIGN.md` |
| [`docs/LINE.md`](../../LINE.md) | LINE Flex bubble rules | Brand colors align with `DESIGN.md` §2 |
| [`README.md`](../../../README.md) | Dev onboarding | Links `DESIGN.md` + `npm run design:audit` |
| [`docs/internal/governance/IMPLEMENTATION_TRUTH.md`](../governance/IMPLEMENTATION_TRUTH.md) | Technical truth | Lists design audit as enforced capability |

---

## 3. Stale / superseded claims (mark in reports, do not delete source files)

| Source | Stale claim | Current truth |
|--------|-------------|---------------|
| [`docs/internal/executive/ENGINEERING_ASSESSMENT.md`](../executive/ENGINEERING_ASSESSMENT.md) §P1-3 | "No booking progress indicator" | **Superseded** — `BookingStepProgress` shipped (#221, `7cd0e72`) |
| Same doc §Product Engineer | "Design system split (editorial landing vs amber/gray booking)" | **Partially true** — `/book` uses `CustomerShell` but step UI still `gray-*` / `amber-*`; not full token migration |
| Same doc §P2-1 | "No `loading.tsx` / `error.tsx` route segments" | **Partially superseded** — `src/app/book/loading.tsx` and `error.tsx` exist; waitlist routes still lack them |
| [`docs/internal/executive/OUTCOME_LOG.md`](../executive/OUTCOME_LOG.md) | "MEASURED via Outcome Pipeline" as complete | **Conditional** — Phase 1 exit requires operator-only path without treating access failure as zero (#239 Part 1); work in progress on `chore/task-239` |

No document was found that defines an **alternate** color system or typography SSOT. Stale items are **status drift**, not competing authorities.

---

## 4. Open-source references (adopted vs rejected)

Documented in `DESIGN.md` §11 and `HALLMARK_ADOPTION.md` §5:

| Project | Role | Adopted | Rejected |
|---------|------|---------|----------|
| [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) | **Document structure** for agent-readable design files | Section layout, agent quick prompt | N/A |
| [Nutlope/hallmark](https://github.com/Nutlope/hallmark) | **Anti-slop audit** methodology | Subset of slop-test gates → `design-slop-audit.sh` + §11 | Default build / 20 themes / full redesign |
| [CronusL-1141/AI-company](https://github.com/CronusL-1141/AI-company) | Engineering autonomy (orchestrator) | Task wall patterns (#177) | UI theming |

**License / attribution:** Hallmark and awesome-design-md are reference methodologies only — no code vendored. Hallmark optional install: `npx skills add nutlope/hallmark` with explicit `DESIGN.md` constraint (see HALLMARK_ADOPTION §3.3).

---

## 5. `npm run design:audit`

**Script:** [`scripts/design-slop-audit.sh`](../../../scripts/design-slop-audit.sh)  
**Command:** `npm run design:audit` · strict mode: `npm run design:audit -- --strict`

**Run on 2026-07-19 (target=`src`, non-strict):** 2 pattern groups, exit 0.

| ID | Pattern | Hits (sample) | DESIGN.md rule |
|----|---------|---------------|----------------|
| S3 | `transition-all` | `page.tsx` CTA, `AddReservationForm` toggle, `admin/page.tsx` shortcuts | §11 #4 — specify properties |
| S5 | Cold blue interactive | `AddReservationForm` peer toggle, guest count pills; `admin/orders`, `admin/reports` | §11 #5 — caramel/stone/amber |

**Documented exceptions (already in DESIGN.md §11):**

- Admin `/admin/*` may use `stone` / `amber` (density).
- Booking form internal components may migrate incrementally.

**Rules written but not fully implemented:**

| Rule | Written | Implemented |
|------|---------|-------------|
| Caramel-only guest accent | §2, §9 | **Partial** — booking steps use `gray-*`, `amber-*`; blue toggle in form |
| Serif titles | §3 | **Yes** on landing + CustomerShell; step labels use sans medium |
| Touch ≥44px, safe-area sticky | §9 | **Yes** — `.sticky-bottom-safe`, `.pb-sticky-form` |
| No `transition-all` | §11 | **No** — 4 files still hit |
| lucide stroke 1.5 | §4 | **Mostly** — consistent in newer components |
| Anti-slop CI gate | HALLMARK_ADOPTION, README | **Optional** — audit exits 0 unless `--strict` |

---

## 6. Pages: migrated vs inconsistent

### Guest — aligned with CustomerShell + contract

| Route | Shell | Step progress | Token alignment | Notes |
|-------|-------|---------------|-----------------|-------|
| `/book` | `CustomerShell` | `BookingStepProgress` | Partial — shell uses Warm Artisan; steps use legacy gray/amber | Slot loading skeleton + retry (#221); draft persistence |
| `/book/query` | `CustomerShell` | — | Partial | Deposit / LINE bind strong per ENGINEERING_ASSESSMENT |
| `/book/success` | `CustomerShell` | — | Partial | Single h1 via shell |

### Guest — inconsistent (not on contract)

| Route | Issue |
|-------|-------|
| `/book/waitlist`, `/waitlist/confirm`, `/waitlist/success` | Custom header (ArrowLeft + LanguageSwitcher), no `CustomerShell`, raw `fetch` without timeout (PR #200 scope) |
| `/book/confirm-visit` | Same legacy header pattern |
| `/` (landing) | **Canonical Warm Artisan** editorial — reference implementation |

### Admin — intentional deviation

| Area | DESIGN.md stance | Actual |
|------|------------------|--------|
| `/admin/*` | stone/amber allowed | stone/amber + some `blue-*` in reports/orders maps |
| `AddReservationForm` (staff booking) | incremental alignment | blue toggle + gray form controls |

---

## 7. Conflicts resolved

| Potential conflict | Resolution |
|--------------------|------------|
| `customer-ui-contract.md` vs `DESIGN.md` | **No conflict** — contract defers palette to DESIGN.md |
| Hallmark vs brand | **Resolved in HALLMARK_ADOPTION** — audit only, no theme override |
| `globals.css` `--amber` vs DESIGN `caramel` | **Naming alias** — same hex values; Tailwind exposes both `caramel` and legacy amber usage |
| Phase 2 `design.md` vs repo `DESIGN.md` | **Naming only** — canonical content lives in `DESIGN.md` |

---

## 8. Recovery actions (docs-only this task)

1. **Keep** `DESIGN.md` as sole SSOT — no `design-v2`, no parallel token doc.
2. **Do not add** `design.md` pointer unless a tool fails on case — current ecosystem uses `DESIGN.md`.
3. **Mark superseded** in triage: ENGINEERING_ASSESSMENT P1-3 (progress indicator), partial OUTCOME_LOG "complete" wording.
4. **Next engineering** (not this doc task): fix S5 hits on guest booking form; optional `--strict` in CI after guest path clean.
5. **Migrate** waitlist + confirm-visit to `CustomerShell` when touching those routes — not a new design file.

---

## 9. Verification checklist

- [x] Single canonical file identified
- [x] No parallel design system files in repo
- [x] Hallmark / OSS refs catalogued with adopt/reject
- [x] `design:audit` executed with hit list
- [x] Page migration matrix documented
- [x] Stale doc claims flagged
- [ ] `--strict` design audit passing (future — blocked on S3/S5 fixes)

---

*Phase 2 Task A · Design SSOT recovery · docs-only*
