-- REVIEW DRAFT. This restores anon table-level SELECT and therefore re-exposes
-- internal fields. Use only after target-specific incident, security and policy
-- review; compare a fresh full ACL snapshot with the pre-change snapshot first.
BEGIN;
DO $ack$ BEGIN
  IF current_setting('sunrise.branches_acl_rollback_ack', true) IS DISTINCT FROM 'reviewed-exposure-and-target' THEN
    RAISE EXCEPTION 'reviewed rollback target and renewed exposure acknowledgement required';
  END IF;
END $ack$;
LOCK TABLE public.branches IN ACCESS EXCLUSIVE MODE;
DO $guard$
DECLARE
  allowed text[] := ARRAY['id','name','address','phone','open_time','close_time',
    'closed_dates','display_name','rental_notes','deposit_info','archived_at'];
  expected text[] := ARRAY['address','archived_at','close_time','closed_dates','created_at',
    'deposit_info','display_name','google_review_url','id','line_group_id','line_pay_url',
    'name','open_time','payment_info','phone','rental_notes','weekly_hours'];
  actual text[];
  a record;
  owner_oid oid;
BEGIN
  SELECT relowner INTO owner_oid FROM pg_class WHERE oid='public.branches'::regclass;
  SELECT array_agg(attname::text ORDER BY attname::text) INTO actual FROM pg_attribute
    WHERE attrelid='public.branches'::regclass AND attnum>0 AND NOT attisdropped;
  IF pg_get_userbyid(owner_oid) <> 'postgres' OR current_user <> pg_get_userbyid(owner_oid)
    OR actual IS DISTINCT FROM expected
    OR NOT (SELECT relrowsecurity AND NOT relforcerowsecurity FROM pg_class WHERE oid='public.branches'::regclass)
    OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.branches'::regclass) <> 1
    OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.branches'::regclass
      AND polcmd='r' AND polpermissive AND polwithcheck IS NULL AND polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='anon')]
      AND pg_get_expr(polqual,polrelid)='true')
    OR has_table_privilege('anon','public.branches','SELECT')
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon' AND (rolsuper OR rolbypassrls OR rolcanlogin))
    OR EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname <> 'anon' AND pg_has_role('anon',r.oid,'MEMBER'))
    OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) p
      WHERE c.oid='public.branches'::regclass AND p.grantee=0 AND p.privilege_type='SELECT') THEN
    RAISE EXCEPTION 'rollback ACL or role assumptions changed';
  END IF;
  FOR a IN SELECT attname,attnum,attacl FROM pg_attribute
    WHERE attrelid='public.branches'::regclass AND attnum>0 AND NOT attisdropped LOOP
    IF has_column_privilege('anon','public.branches',a.attnum,'SELECT') IS DISTINCT FROM (a.attname::text=ANY(allowed))
      OR (a.attname::text=ANY(allowed) AND NOT EXISTS (
        SELECT 1 FROM aclexplode(a.attacl) p WHERE p.grantee='anon'::regrole AND p.grantor=owner_oid
          AND p.privilege_type='SELECT' AND NOT p.is_grantable))
      OR EXISTS (SELECT 1 FROM aclexplode(a.attacl) p WHERE NOT (
        p.grantee='anon'::regrole AND p.grantor=owner_oid AND p.privilege_type='SELECT' AND NOT p.is_grantable)) THEN
      RAISE EXCEPTION 'rollback column ACL assumptions changed';
    END IF;
  END LOOP;
END
$guard$;
REVOKE SELECT (id,name,address,phone,open_time,close_time,closed_dates,display_name,
  rental_notes,deposit_info,archived_at) ON public.branches FROM anon;
GRANT SELECT ON TABLE public.branches TO anon;
DO $check$ BEGIN
  IF NOT has_table_privilege('anon','public.branches','SELECT')
    OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.branches'::regclass
      AND attnum>0 AND NOT attisdropped AND attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'rollback verification failed';
  END IF;
END $check$;
COMMIT;
