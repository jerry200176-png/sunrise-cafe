# Design enforcement — Phase 2 minimum contract (Sunrise)

Authority: [`DESIGN.md`](../../../DESIGN.md) (Warm Artisan Editorial)

## Already enforced

| Check | Command | Notes |
|-------|---------|-------|
| Design slop audit | `npm run design:audit` | Flags cold blue, `transition-all`, etc. |
| Hallmark adoption | `docs/internal/design/HALLMARK_ADOPTION.md` | Audit criteria only — not a parallel system |

## PR checklist (user-facing)

- [ ] First-time guest can complete without staff instruction
- [ ] Booking / deposit states explicit (never conflate LINE accepted with delivered)
- [ ] Customer vs staff terminology differ appropriately
- [ ] Mobile-first; touch targets adequate
- [ ] Error recovery does not wipe booking input
- [ ] Loading / empty / error / partial states covered
- [ ] Focus / keyboard reachable for interactive controls
- [ ] No native `alert()` / `prompt()`
- [ ] Screenshots: desktop + mobile + loading/empty/error where changed
- [ ] Not color/radius/shadow-only “UX”

## Outcome dashboard rule

Access failure (`unauthorized` / `unavailable`) must never render as zero bookings. Prefer `—` + alert copy.

## Not required this phase

Heavy visual-regression infrastructure.
