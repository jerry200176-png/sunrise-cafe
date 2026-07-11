# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| main / latest release | Yes |
| Older tags | Best-effort |

Production site: https://sunrise-cafe-six.vercel.app

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security reports.

Instead, contact the repository owner privately via GitHub Security Advisories:

1. Open https://github.com/jerry200176-png/sunrise-cafe/security/advisories/new
2. Include: affected URL/path, reproduction steps, impact, and any suggested fix
3. Allow a reasonable window for patching before public disclosure

We aim to acknowledge reports within **7 days** and ship fixes for confirmed issues as soon as practical.

## Scope

In scope examples:
- Auth bypass on `/api/admin/*` or guest booking APIs
- PII exposure (phone numbers, booking data)
- Secrets / env leakage
- Payment marking without authorization

Out of scope examples:
- Denial of service / rate-limit volume tests without prior coordination
- Issues only present on outdated local checkouts
- Social engineering of shop staff

## Security features already in use

- Secret scanning + push protection (GitHub)
- Dependabot alerts and security updates
- CI `npm audit` (see workflows)