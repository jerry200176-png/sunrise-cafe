-- SYNTHETIC REVIEW FIXTURE ONLY: refuses every database except the disposable test DB.
-- This is not a production migration. A production package needs its own target binding,
-- fresh privilege snapshot, consumer review, rollback and governance review.
BEGIN;
DO $database_guard$ BEGIN
  IF current_database() <> 'sunrise_privacy_fixture' THEN
    RAISE EXCEPTION 'synthetic fixture requires its disposable test database';
  END IF;
END $database_guard$;
LOCK TABLE public.branches IN ACCESS EXCLUSIVE MODE;
DO $guard$
DECLARE
  expected text[] := ARRAY['address','archived_at','close_time','closed_dates','created_at',
    'deposit_info','display_name','google_review_url','id','line_group_id','line_pay_url',
    'name','open_time','payment_info','phone','rental_notes','weekly_hours'];
  actual text[];
BEGIN
  SELECT array_agg(attname::text ORDER BY attname::text) INTO actual
  FROM pg_attribute WHERE attrelid='public.branches'::regclass AND attnum>0 AND NOT attisdropped;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'unexpected fixture schema'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.branches'::regclass)
    OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.branches'::regclass) <> 1
    OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.branches'::regclass
      AND polcmd='r' AND polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='anon')]
      AND pg_get_expr(polqual,polrelid)='true') THEN
    RAISE EXCEPTION 'unexpected fixture RLS policy';
  END IF;
  IF NOT has_table_privilege('anon','public.branches','SELECT')
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon' AND (rolsuper OR rolbypassrls))
    OR EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname <> 'anon' AND pg_has_role('anon',r.oid,'MEMBER'))
    OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.branches'::regclass
      AND attnum>0 AND NOT attisdropped AND attacl IS NOT NULL)
    OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) p
      WHERE c.oid='public.branches'::regclass AND p.grantee=0 AND p.privilege_type='SELECT') THEN
    RAISE EXCEPTION 'unexpected fixture ACL';
  END IF;
END
$guard$;
REVOKE SELECT ON TABLE public.branches FROM anon;
GRANT SELECT (id,name,address,phone,open_time,close_time,closed_dates,display_name,
  rental_notes,deposit_info,archived_at) ON public.branches TO anon;
DO $check$
DECLARE
  a record;
  allowed text[] := ARRAY['id','name','address','phone','open_time','close_time',
    'closed_dates','display_name','rental_notes','deposit_info','archived_at'];
BEGIN
  IF has_table_privilege('anon','public.branches','SELECT') THEN
    RAISE EXCEPTION 'table-level anon SELECT remains';
  END IF;
  FOR a IN SELECT attname,attnum FROM pg_attribute
    WHERE attrelid='public.branches'::regclass AND attnum>0 AND NOT attisdropped LOOP
    IF has_column_privilege('anon','public.branches',a.attnum,'SELECT') IS DISTINCT FROM (a.attname::text=ANY(allowed)) THEN
      RAISE EXCEPTION 'column ACL check failed';
    END IF;
  END LOOP;
END
$check$;
COMMIT;
