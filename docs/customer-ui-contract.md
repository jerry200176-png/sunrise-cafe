# Customer UI component contract

> Contract for guest shell components introduced for booking / query / success.
> Brand tokens remain in [`DESIGN.md`](../DESIGN.md). This file is **not** a full product design system.

Evidence: component sources under `src/components/customer/`, page wiring in `src/app/book/**`, and Vitest coverage in matching `*.test.tsx` / `customer-shell-i18n.test.ts`.

---

## 1. Scope

| In scope | Out of scope |
|----------|--------------|
| `CustomerShell` | Admin UI / AdminShell |
| `BookingStepProgress` | Full brand typography / color SSOT (see `DESIGN.md`) |
| `EmptyState` | Toast libraries, skeletons, admin tables/modals |
| Reuse of upstream `CopyBookingCodeButton` | Guarantees not backed by tests or measured audits |

---

## 2. Components

### 2.1 CustomerShell

**Path:** `src/components/customer/CustomerShell.tsx`  
**Boundary:** client component (`useLocale` / `LanguageSwitcher`).

- Sticky header: back link (`aria-label` from `common.back`), logo, sole page `h1` (`title`), language switcher.
- Content column: `max-w-lg mx-auto px-4 py-6`.
- Pages that use it own one shell `h1` — do not add a second page-level `h1`.

### 2.2 BookingStepProgress

**Path:** `src/components/customer/BookingStepProgress.tsx`  
**Tests:** `src/components/customer/BookingStepProgress.test.tsx`

| Rule | Behavior |
|------|----------|
| Steps | `branch` → `date` → `room` → `slot` → `form` |
| `hideBranch` | Omits branch when single-store auto-skip |
| Current | Non-interactive; `aria-current="step"` |
| Completed | Interactive `button` only when `onSelectCompletedStep` is provided |
| Incomplete | Never interactive |
| Callback | `onSelectCompletedStep(step)` — name means **completed steps only** |

Callers must pass the page’s existing back-navigation helper (e.g. booking `goToStep`); this component does not own booking state.

### 2.3 EmptyState

**Path:** `src/components/customer/EmptyState.tsx`  
**Tests:** `src/components/customer/EmptyState.test.tsx`

| Prop | Role |
|------|------|
| `icon` | Decorative; wrapped `aria-hidden` |
| `title` / `description` | What happened |
| `action` | Optional next step control (caller supplies link/button) |
| `announceStatus` | Optional. When `true`, root gets `role="status"` for **dynamic** empty results. Default `false` so static hints are not live regions. |

### 2.4 Booking code copy

Use upstream `CopyBookingCodeButton` (`src/components/CopyBookingCodeButton.tsx`). Do not add a parallel guest copy control.

---

## 3. Tokens (pointer only)

Customer shell classes use existing Warm Artisan tokens (`paper`, `ink`, `caramel`, `font-serif`, `.grain`) from `src/app/globals.css` and `tailwind.config.ts`, documented in `DESIGN.md`.  
This contract does **not** redefine the palette or claim contrast audits.

---

## 4. Accessibility (implemented)

Verified in components / unit tests (not a full WCAG audit):

- Step nav: `nav` + `aria-label` from `book.stepProgress`
- Current step: `aria-current="step"`
- Completed step controls: native `button` + focus-visible ring
- Back control: `aria-label`
- Icons without text: `aria-hidden` where decorative
- Empty dynamic results: opt-in `announceStatus` (not hard-coded on every EmptyState)

**Recommendation (not a guarantee):** keep color from being the only status cue (step number + label text already accompany fill color).

---

## 5. i18n

Guest copy via `useLocale()` → `src/lib/i18n/translations.ts` for locales `zh-TW`, `en`, `ja`.

Shell-related keys covered by `src/lib/i18n/customer-shell-i18n.test.ts` (value present and not equal to the raw key).

---

## 6. Checklist — new guest screen using this shell

- [ ] Wrap with `CustomerShell`; single `h1` via shell `title`
- [ ] Booking wizard: `BookingStepProgress` + existing step guard (no forward skip)
- [ ] Empty / no-result: `EmptyState` with clear next step; use `announceStatus` only for dynamic results
- [ ] Strings in `translations.ts` for zh-TW / en / ja
- [ ] Prefer existing tokens from `DESIGN.md` over inventing a parallel palette
