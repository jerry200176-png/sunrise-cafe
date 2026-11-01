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
  expected_table_acl text[];
  actual_table_acl text[];
  a record;
  owner_oid oid;
BEGIN
  SELECT relowner INTO owner_oid FROM pg_class WHERE oid='public.branches'::regclass;
  SELECT array_agg(attname::text ORDER BY attname::text) INTO actual FROM pg_attribute
    WHERE attrelid='public.branches'::regclass AND attnum>0 AND NOT attisdropped;
  -- Compare the complete, reviewed PG17 table ACL as an unordered set while
  -- holding the table lock. Any grantor, role, privilege or grant-option drift
  -- requires a fresh snapshot and review, not a best-effort rollback.
  SELECT array_agg(entry ORDER BY entry COLLATE "C") INTO expected_table_acl
  FROM (
    SELECT format('postgres:%s:%s:false', role_name, privilege_name) AS entry
    FROM unnest(ARRAY['postgres','anon','authenticated','service_role']) role_name
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) privilege_name
    WHERE NOT (role_name='anon' AND privilege_name='SELECT')
  ) expected_entries;
  SELECT array_agg(entry ORDER BY entry COLLATE "C") INTO actual_table_acl
  FROM (
    SELECT format('%s:%s:%s:%s', pg_get_userbyid(p.grantor),
      CASE WHEN p.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(p.grantee) END,
      p.privilege_type, p.is_grantable::text) AS entry
    FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) p
    WHERE c.oid='public.branches'::regclass
  ) actual_entries;
  IF pg_get_userbyid(owner_oid) <> 'postgres' OR current_user <> pg_get_userbyid(owner_oid)
    OR actual IS DISTINCT FROM expected
    OR actual_table_acl IS DISTINCT FROM expected_table_acl
    OR NOT (SELECT relrowsecurity AND NOT relforcerowsecurity FROM pg_class WHERE oid='public.branches'::regclass)
    OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.branches'::regclass) <> 1
    OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.branches'::regclass
      AND polcmd='r' AND polpermissive AND polwithcheck IS NULL AND polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='anon')]
      AND pg_get_expr(polqual,polrelid)='true')
    OR has_table_privilege('anon','public.branches','SELECT')
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon' AND (rolsuper OR rolbypassrls OR rolcanlogin))
    OR (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated')
        AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin AND rolinherit) <> 2
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role'
        AND NOT rolsuper AND rolbypassrls AND NOT rolcanlogin AND rolinherit)
    OR EXISTS (SELECT 1 FROM pg_roles member CROSS JOIN pg_roles granted
        WHERE member.rolname IN ('anon','authenticated','service_role') AND member.oid <> granted.oid
          AND pg_has_role(member.oid,granted.oid,'MEMBER'))
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
