# Staging Environment Strategy

## Current state

Sunrise Cafe uses **Vercel preview deployments** as implicit staging:

| Environment | Trigger | URL |
|-------------|---------|-----|
| Production | Push to `main` | `https://sunrise-cafe-six.vercel.app` |
| Preview | PR branches | `https://sunrise-cafe-*.vercel.app` |

## Recommended setup

### Supabase

- **Option A (recommended):** Separate Supabase project for staging
- **Option B:** Shared project with `staging_` prefix tables (not currently implemented)

### Environment variables (Preview)

Set in Vercel → Settings → Environment Variables → **Preview**:

```
NEXT_PUBLIC_SUPABASE_URL=<staging project>
SUPABASE_SERVICE_ROLE_KEY=<staging key>
ADMIN_PASSWORD=<staging password>
SESSION_SECRET=<staging secret>
LINE_* = <staging LINE channel or sandbox>
```

### What to test on preview

1. Full booking flow
2. Guest auth (phone + booking code)
3. Admin dashboard + operations overview
4. Analytics events (after migration applied to staging DB)
5. LINE OAuth (register preview URL in LINE Developers console)

### Promotion to production

1. Merge PR to `main`
2. `verify-production` workflow confirms SHA
3. Run any new migrations on **production** Supabase
4. Manual smoke per `docs/RELEASE.md`

## Do not

- Point preview at production Supabase with test data pollution risk
- Skip migration on production after staging validated
