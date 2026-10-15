# Orders: server-side pricing and removing anon direct INSERT (#434)

Status: **app fix in this PR; SQL prepared only, not applied.** Applying the SQL needs the Founder.

## Problem

1. `POST /api/orders` (the QR table order) computed `total_amount` and `order_items.unit_price`
   from the price, name and option `delta` the browser sent. A guest could edit the cart in
   localStorage or replay the request and order at any price.
2. RLS policies `anon_insert_orders` / `anon_insert_order_items` (last defined in
   `supabase/migration-booking-meals.sql`) let anyone holding the public anon key insert rows
   straight into `orders` / `order_items` through PostgREST, skipping the API and its checks.

## What changes

### App (this PR, ships with the normal deploy)

- `src/lib/table-order-pricing.ts`: pure parsing + pricing. The cart is read only as
  "menu item id, quantity, option group/name, note". Name, base price and option price
  are loaded from `menu_items` / `menu_item_options` of the table's own branch.
- `POST /api/orders` returns **400** with a clear message for: unknown item, item of another
  branch, unavailable item, unknown option, option rule broken, quantity that is not an integer
  1–99, more than 50 lines, malformed body. Table checks (404 unknown, 403 inactive) are unchanged.
- Response shape unchanged: `{ ok: true, orderId }`.
- Other order writers checked: `admin/reservation-orders/[id]` inserts order items from
  server-side preorder snapshots (`reservation-preorder.ts` already prices from the menu) and
  is owned by the open settlement PRs #447/#448/#450/#452, so it is not touched here.
  `create_booking_with_meals` (RPC) is called by the server with the service role.

### SQL (prepared, `manual_sql_editor`, never auto-applied)

- `supabase/migration-orders-anon-insert-revoke.sql`
  - drops policies `anon_insert_orders` and `anon_insert_order_items`;
  - `REVOKE INSERT` on both tables from `anon, authenticated`;
  - records `20261015-orders-anon-insert-revoke` in `schema_migrations`.
  - Does **not** touch SELECT policies (the admin orders page, print station and reservation
    list use anon realtime subscriptions, which need SELECT only), `service_role`, or any row.
- sha256 `ae95a21bd75b816ac1771a6f3d1041c8c56c4470686f832422ab8c4011b00b17`
- Registered in `scripts/production-migration-plan.json` with `"execution": "manual_sql_editor"`
  and no runner, so `run-production-migration-phase.mjs` skips it.

## Direct anon-insert client paths (checked on main, 2026-10-15)

- None. The QR cart (`src/app/order/[tableToken]/cart/page.tsx`) posts to `/api/orders`.
- The browser anon client (`src/lib/supabase.ts`) is used only for realtime `channel(...)`
  subscriptions in `admin/orders`, `admin/print-station` and `ReservationList` (read only).
- `print-bridge/` uses `SUPABASE_SERVICE_ROLE_KEY` and only updates `is_printed`.
- Nothing outside this repo is known to insert orders with the anon key. Before applying,
  confirm no other tool (e.g. an old kiosk build) does.

## Order of operations

1. Merge this PR and let the normal production deploy ship the app. Verify:
   - `GET /api/version` shows the merge SHA;
   - a real QR order on a test table succeeds, shows the menu price in the admin orders page,
     and prints;
   - a tampered request (edited price) is accepted with the menu price, and an unknown item
     gets a 400.
2. Founder runs `supabase/migration-orders-anon-insert-revoke.sql` in the Supabase SQL Editor
   (it wraps itself in `BEGIN/COMMIT`). Check the file's sha256 first.
3. Verify in the SQL Editor:
   ```sql
   SELECT policyname, cmd, roles FROM pg_policies WHERE tablename IN ('orders','order_items') ORDER BY 1;
   -- expect no INSERT policy for anon
   SELECT has_table_privilege('anon','orders','INSERT')        AS anon_orders,
          has_table_privilege('anon','order_items','INSERT')   AS anon_items,
          has_table_privilege('anon','orders','SELECT')        AS anon_read;
   -- expect false, false, true
   SELECT version FROM schema_migrations WHERE version = '20261015-orders-anon-insert-revoke';
   ```
   Then place one more QR order through the app and confirm the admin orders page and print
   station still update in real time.

Do not probe by inserting into production with the anon key; the SQL checks above are enough.

## Rollback

- App: revert the PR (no schema dependency; the old route still works with or without the SQL).
- SQL: run `supabase/rollbacks/orders-anon-insert-revoke.sql`
  (sha256 `efe08597fe59b3afd8e2503ef76148dff2290fe728eff50b7d03c63e690d180a`). It restores the
  INSERT grants and recreates the two policies exactly as `migration-booking-meals.sql` defined
  them, deletes the ledger row, and touches no order data. Only needed if some direct anon
  writer turns out to exist; the app itself never needs the anon INSERT.

## Tests

- `src/app/api/orders/route.test.ts`: menu pricing, tampered price/name/delta ignored, 400 cases,
  branch filter, table 404/403.
- `src/lib/orders-anon-insert-revoke-migration.test.ts`: plan registration, SQL scope, rollback
  matches booking-meals, sha256 pinned here.
- `scripts/test-orders-rls-sql.sh` runs `supabase/tests/orders-anon-insert-revoke.test.sql` on a
  throwaway local PostgreSQL: anon insert works before, is rejected after, service_role still
  inserts, anon SELECT unchanged, idempotent rerun, rollback restores, re-apply works.
  Not wired into CI here to avoid editing `ci.yml`, which PR #448 changes.
