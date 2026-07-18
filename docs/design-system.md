# Customer Design System (guest shell)

> Component contract for guest shell UI on `origin/main`.
> Visual tokens originate from [DESIGN.md](../DESIGN.md) (Warm Artisan Editorial).
> **Goal:** Customer booking / query / success pages share one shell language.

---

## 1. Design principles

| Principle | Application |
|-----------|-------------|
| **Clarity over density** | One primary action per viewport section; progressive disclosure in booking wizard |
| **Warm, trustworthy** | Paper + ink + caramel palette; no cold blues as primary accent on customer flows |
| **Mobile-first** | `max-w-lg` customer column, 44px+ touch targets, sticky headers |
| **Recoverable errors** | Human copy + next step; never expose dev diagnostics to guests |
| **Consistent shell** | `CustomerShell` for all guest pages; future `AdminShell` for staff |

---

## 2. Typography

| Token | Font | Usage |
|-------|------|--------|
| `font-serif` | Noto Serif TC | Page titles, step labels, empty states |
| `font-display` | Fraunces | Brand wordmark, EN small-caps labels |
| `font-sans` | Noto Sans TC | Body, forms, tables |

**Scale (customer)**

| Element | Classes |
|---------|---------|
| Page title (header) | `font-serif text-base font-medium text-ink` |
| Section heading | `font-serif text-lg text-ink` |
| Body | `text-sm text-ink-soft leading-relaxed` |
| Caption / hint | `text-xs text-ink-faint` |
| Booking code | `font-mono text-2xl font-bold tracking-wider text-ink` |

---

## 3. Color

Use Tailwind tokens from `tailwind.config.ts` and CSS variables in `globals.css`:

```
paper / paper-deep / latte
ink / ink-soft / ink-faint
caramel / caramel-deep / caramel-glow
```

**Semantic colors (functional, not brand)**

| State | Customer | Admin |
|-------|----------|-------|
| Success | `emerald-600` | `green-600` |
| Warning / deposit | `amber-50` + `caramel-deep` text | `amber-50` |
| Error | `red-50` + `red-800` | `red-50` |
| Full / unavailable | `rose-50` + `rose-600` | `rose-100` |
| LINE CTA | `#06C755` | — |

**Primary CTA gradient** (landing + success):

```css
background: linear-gradient(135deg, #b5742c, #9d6519);
box-shadow: 0 10px 30px -12px rgba(157,101,25,0.45);
```

---

## 4. Spacing scale

| Token | Value | Use |
|-------|-------|-----|
| `xs` | `gap-1` / `p-1` | Icon gaps |
| `sm` | `gap-2` / `p-2` | Inline controls |
| `md` | `gap-3` / `p-4` | Card padding |
| `lg` | `py-6` | Page section rhythm |
| `xl` | `mt-12` | Landing hero spacing |

Customer content column: `max-w-lg mx-auto px-4 py-6`.

---

## 5. Components

### 5.1 CustomerShell

Sticky header: back link, logo, title, `LanguageSwitcher`. Paper background + optional `.grain`.

**Path:** `src/components/customer/CustomerShell.tsx`

### 5.2 BookingStepProgress

5-step indicator (branch → date → room → slot → form). Hides branch when single-store.

- Completed steps may call `onSelectCompletedStep` (back-nav only).
- Current / incomplete steps are not interactive.
- Mobile: step numbers + `aria-label`; labels visible from `sm` breakpoint.

**Path:** `src/components/customer/BookingStepProgress.tsx`

### 5.3 EmptyState

Icon + title + description + optional action. Used for query hint, empty slots, no results.

**Path:** `src/components/customer/EmptyState.tsx`

### 5.4 Booking code copy

Use upstream `CopyBookingCodeButton` (`src/components/CopyBookingCodeButton.tsx`) — do not add a parallel guest copy control.

### 5.5 Buttons

| Variant | Classes |
|---------|---------|
| Primary | `rounded-xl bg-caramel text-white hover:bg-caramel-deep` or gradient CTA |
| Secondary | `rounded-xl border border-ink/10 bg-white/70 hover:border-caramel/40` |
| Destructive | `rounded-lg border border-red-200 text-red-700 hover:bg-red-50` |
| LINE | `rounded-xl bg-[#06C755] text-white` |

Min height: `py-2.5` (mobile), full-width on form submit steps.

### 5.6 Forms

- Inputs: `rounded-xl border border-gray-300 px-4 py-3 text-base`
- Labels: `text-sm font-medium text-gray-700`
- Required marker in label text (`*`)
- Error: `role="alert"` banner above form

### 5.7 Cards

- Default: `rounded-xl border border-gray-200 bg-white shadow-sm`
- Selected / summary: `bg-paper-deep` or `bg-emerald-50 border-emerald-100`
- Deposit callout: `rounded-xl bg-paper-deep border border-caramel/20`

### 5.8 Tables (admin)

- Prefer card lists on mobile; `<table>` only for dense data (rooms list)
- Future: sticky header + zebra `even:bg-gray-50`

### 5.9 Modals (admin)

Pattern from `AddReservationForm`: `fixed inset-0 z-50`, bottom sheet on mobile (`items-end sm:items-center`).

### 5.10 Notifications

- Customer: inline `role="alert"` banners (no toast lib yet)
- Admin: migrate from `alert()` → toast (P2 backlog)

### 5.11 Loading

- Text: `t("common.loading")` centered
- Future: skeleton cards for room list

### 5.12 Empty states

Always include: **what happened** + **what to do next** + optional CTA link.

---

## 6. Motion

- Landing: `.rise` stagger, `.sun-breathe`
- Customer transitions: `transition hover:` on cards; `animate-in fade-in` on booking summary
- Respect `prefers-reduced-motion` (see `globals.css`)

---

## 7. Accessibility

- `sr-only` labels on icon-only controls
- `aria-current="step"` on booking progress
- `aria-label` on back buttons
- Language toggle: `aria-current` on active locale
- Minimum contrast: ink on paper (WCAG AA)
- Avoid emoji as sole affordance; pair with text or Lucide icons

---

## 8. i18n

All customer-facing copy via `useLocale()` → `translations.ts` (zh-TW, en, ja).

Pages requiring i18n: `/`, `/book/**` (including success), `/book/query`, `/book/waitlist/**`.

---

## 9. File map

| Area | Components | Pages |
|------|------------|-------|
| Customer shell | `src/components/customer/*` | `src/app/page.tsx`, `src/app/book/**` |
| Admin (future) | `src/components/admin/*` (planned) | `src/app/admin/**` |
| Tokens | `globals.css`, `tailwind.config.ts` | — |
| Copy | `src/lib/i18n/translations.ts` | — |

---

## 10. Adoption checklist (new screen)

- [ ] Uses `CustomerShell` or `AdminShell`
- [ ] Brand colors (not raw `gray-50` page bg on customer)
- [ ] Primary CTA obvious above fold on mobile
- [ ] Empty + error states with recovery action
- [ ] All strings in `translations.ts`
- [ ] Touch targets ≥ 44px height
