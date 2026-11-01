-- Catalog evidence only. This file is run inside a read-only transaction.
WITH target_table AS (
  SELECT c.oid
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'line_reminder_deliveries'
    AND c.relkind IN ('r', 'p')
), target_function AS (
  SELECT p.* FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.claim_line_reminder_delivery(text,date,uuid,text,text)')
), expected_columns(name, type, required) AS (
  VALUES ('id', 'pg_catalog.uuid'::regtype, true), ('reminder_type', 'pg_catalog.text'::regtype, true),
    ('reminder_date', 'pg_catalog.date'::regtype, true), ('reservation_id', 'pg_catalog.uuid'::regtype, true),
    ('recipient_type', 'pg_catalog.text'::regtype, true), ('recipient_id', 'pg_catalog.text'::regtype, true),
    ('status', 'pg_catalog.text'::regtype, true), ('attempt_count', 'pg_catalog.int4'::regtype, true),
    ('last_error', 'pg_catalog.text'::regtype, false), ('message_count', 'pg_catalog.int4'::regtype, true),
    ('created_at', 'pg_catalog.timestamptz'::regtype, true), ('sent_at', 'pg_catalog.timestamptz'::regtype, false)
), reservation_columns(name, type) AS (
  VALUES ('id', 'pg_catalog.uuid'::regtype), ('status', 'pg_catalog.text'::regtype), ('is_notified', 'pg_catalog.bool'::regtype),
    ('is_deposit_paid', 'pg_catalog.bool'::regtype), ('is_reminded_7d', 'pg_catalog.bool'::regtype),
    ('deposit_reminder_sent_at', 'pg_catalog.timestamptz'::regtype),
    ('deposit_urgent_reminder_sent_at', 'pg_catalog.timestamptz'::regtype),
    ('d1_guest_reminder_sent_at', 'pg_catalog.timestamptz'::regtype)
)
SELECT
  EXISTS (SELECT 1 FROM target_table) AS table_present,
  NOT EXISTS (
    SELECT 1 FROM expected_columns e
    WHERE NOT EXISTS (
      SELECT 1 FROM target_table t JOIN pg_attribute a ON a.attrelid = t.oid
      WHERE a.attname = e.name AND a.attnum > 0 AND NOT a.attisdropped
        AND a.atttypid = e.type AND a.atttypmod = -1
        AND (NOT e.required OR a.attnotnull)
    )
  ) AS columns_present,
  NOT EXISTS (
    SELECT 1 FROM reservation_columns e
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = to_regclass('public.reservations') AND a.attname = e.name
        AND a.attnum > 0 AND NOT a.attisdropped AND a.atttypid = e.type AND a.atttypmod = -1
    )
  ) AS reservation_columns_present,
  EXISTS (
    SELECT 1 FROM target_table t JOIN pg_constraint c ON c.conrelid = t.oid
    WHERE c.contype = 'p' AND NOT c.condeferrable AND c.convalidated
      AND ARRAY(
        SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum ORDER BY k.ord
      ) = ARRAY['id']
  ) AS id_primary,
  EXISTS (
    SELECT 1 FROM target_table t JOIN pg_constraint c ON c.conrelid = t.oid
    WHERE c.contype = 'f' AND c.convalidated AND c.confdeltype = 'c'
      AND c.confrelid = to_regclass('public.reservations')
      AND ARRAY(
        SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum ORDER BY k.ord
      ) = ARRAY['reservation_id']
      AND ARRAY(
        SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum ORDER BY k.ord
      ) = ARRAY['id']
  ) AS reservation_foreign_key,
  EXISTS (
    SELECT 1 FROM target_table t JOIN pg_constraint c ON c.conrelid = t.oid
    WHERE c.contype = 'u' AND NOT c.condeferrable AND c.convalidated
      AND ARRAY(
        SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum ORDER BY k.ord
      ) = ARRAY['reminder_type', 'reminder_date', 'reservation_id', 'recipient_type', 'recipient_id']
  ) AS claim_unique,
  EXISTS (
    SELECT 1 FROM target_function p
    WHERE p.prosecdef AND p.provolatile = 'v' AND p.proretset
      AND pg_get_function_result(p.oid) = 'TABLE(delivery_id uuid)'
      AND p.proargnames[1:5] = ARRAY['p_reminder_type', 'p_reminder_date', 'p_reservation_id', 'p_recipient_type', 'p_recipient_id']
      AND 'search_path=public' = ANY(p.proconfig)
  ) AS function_shape,
  CASE WHEN to_regrole('service_role') IS NOT NULL AND EXISTS (SELECT 1 FROM target_function)
    THEN has_schema_privilege('service_role', 'public', 'USAGE')
      AND has_function_privilege('service_role', (SELECT oid FROM target_function), 'EXECUTE')
    ELSE false END AS service_execute,
  CASE WHEN to_regrole('service_role') IS NOT NULL AND EXISTS (SELECT 1 FROM target_table)
    THEN has_table_privilege('service_role', (SELECT oid FROM target_table), 'SELECT')
      AND has_table_privilege('service_role', (SELECT oid FROM target_table), 'UPDATE')
      AND has_table_privilege('service_role', (SELECT oid FROM target_table), 'DELETE')
    ELSE false END AS service_table_access,
  CASE WHEN to_regrole('anon') IS NOT NULL AND to_regrole('authenticated') IS NOT NULL
       AND EXISTS (SELECT 1 FROM target_function)
    THEN NOT has_function_privilege('anon', (SELECT oid FROM target_function), 'EXECUTE')
      AND NOT has_function_privilege('authenticated', (SELECT oid FROM target_function), 'EXECUTE')
    ELSE false END AS no_guest_execute;
