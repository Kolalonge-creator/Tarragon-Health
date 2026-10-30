-- OQ-580 proof: approving a lab or pharmacy refund posts a journal entry, so it needs the 'finance.gl.post' permission.
--
-- Before the fix both approve functions checked only private.is_org_staff(), so a care coordinator or a clinician could approve a
-- refund and post to the ledger. Proved in one rolled-back transaction, with a positive control for every refusal:
--   1. a care coordinator and a clinician are refused on the lab and the pharmacy function, by the NEW check (its message), and the
--      refund stays 'requested';
--   2. a finance-role user with no grant is refused;
--   3. a finance-role user with the 'finance.gl.post' grant approves, the refund is approved by that user and carries a journal entry;
--   4. an admin (who holds every permission) approves the pharmacy refund;
--   5. raising a refund was NOT widened to finance-only (the request function is untouched), anon cannot execute either approve function;
--   6. SABOTAGE: with the new check switched off in the function text, the coordinator and the clinician approve, so the refusals above
--      fail. The proof cannot pass vacuously.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.msg(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'oq580-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'OQ580 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  return v;
end $f$;
-- a caller runs a statement as a user and comes back to the owner
create function pg_temp.as_msg(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  r := pg_temp.msg(p_sql);
  perform pg_temp.back();
  return r;
end $f$;
-- Each refund needs a real parent order (the foreign key is checked when the approve function updates the refund). The parent orders are
-- written by the owner with triggers off (replica mode): only their ids matter here, not their costing.
create function pg_temp.lab_refund(p_org uuid, p_patient uuid) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid(); o uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.lab_orders (id, organisation_id, patient_id) values (o, p_org, p_patient);
  insert into public.lab_order_refunds (id, organisation_id, lab_order_id, reason, status, refund_total_kobo, partner_portion_kobo, margin_portion_kobo)
  values (v, p_org, o, 'sample_rejected', 'requested', 1000000, 600000, 400000);
  set local session_replication_role = origin;
  return v;
end $f$;
create function pg_temp.pharm_refund(p_org uuid, p_patient uuid) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid(); o uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.pharmacy_orders (id, organisation_id, patient_id) values (o, p_org, p_patient);
  insert into public.pharmacy_order_refunds (id, organisation_id, pharmacy_order_id, reason, status, refund_total_kobo, partner_portion_kobo, margin_portion_kobo)
  values (v, p_org, o, 'out_of_stock', 'requested', 500000, 300000, 200000);
  set local session_replication_role = origin;
  return v;
end $f$;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;

do $$
declare
  v_org uuid; v_admin uuid; v_coord uuid; v_clin uuid; v_fin uuid; v_fing uuid;
  v_pat uuid; v_lab1 uuid; v_ph1 uuid;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_coord := pg_temp.mkuser(v_org, 'coordinator', 'care_coordinator');
  v_clin := pg_temp.mkuser(v_org, 'clinician', 'clinician');
  v_fin := pg_temp.mkuser(v_org, 'finance-nogrant', 'finance');
  v_fing := pg_temp.mkuser(v_org, 'finance-grant', 'finance');
  insert into public.user_permission_grants (profile_id, permission_key, granted_by) values (v_fing, 'finance.gl.post', v_admin);
  perform pg_temp.setf('coord', v_coord);
  perform pg_temp.setf('clin', v_clin);
  perform pg_temp.setf('org', v_org);

  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_lab1 := pg_temp.lab_refund(v_org, v_pat);
  v_ph1 := pg_temp.pharm_refund(v_org, v_pat);
  perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('lab1', v_lab1);
  perform pg_temp.setf('ph1', v_ph1);

  -- 1. the care team is refused by the new check
  perform pg_temp.rec('a care coordinator is refused on the lab refund, by the finance check', 'true',
    (pg_temp.as_msg(v_coord, format('select public.approve_lab_order_refund(%L)', v_lab1)) like '42501:%needs finance authority%')::text);
  perform pg_temp.rec('a clinician is refused on the lab refund, by the finance check', 'true',
    (pg_temp.as_msg(v_clin, format('select public.approve_lab_order_refund(%L)', v_lab1)) like '42501:%needs finance authority%')::text);
  perform pg_temp.rec('a care coordinator is refused on the pharmacy refund', 'true',
    (pg_temp.as_msg(v_coord, format('select public.approve_pharmacy_order_refund(%L)', v_ph1)) like '42501:%needs finance authority%')::text);
  perform pg_temp.rec('a clinician is refused on the pharmacy refund', 'true',
    (pg_temp.as_msg(v_clin, format('select public.approve_pharmacy_order_refund(%L)', v_ph1)) like '42501:%needs finance authority%')::text);
  perform pg_temp.rec('both refused refunds stay requested, with no journal entry', 'requested,requested,0',
    (select status::text from public.lab_order_refunds where id = v_lab1) || ',' || (select status::text from public.pharmacy_order_refunds where id = v_ph1)
    || ',' || (select count(*)::text from public.finance_journal_entries where source_ref in (v_lab1::text, v_ph1::text)));

  -- 2. a finance-role user with no grant
  perform pg_temp.rec('a finance user without the finance.gl.post grant is refused', 'true',
    (pg_temp.as_msg(v_fin, format('select public.approve_lab_order_refund(%L)', v_lab1)) like '42501:%')::text);

  -- 3. a finance user with the grant approves
  perform pg_temp.rec('a finance user WITH the grant approves the lab refund', 'ok',
    pg_temp.as_msg(v_fing, format('select public.approve_lab_order_refund(%L)', v_lab1)));
  perform pg_temp.rec('...the refund is approved by that user and carries a journal entry', 'approved,true,true',
    (select status::text || ',' || (approved_by = v_fing)::text || ',' || (journal_entry_id is not null)::text from public.lab_order_refunds where id = v_lab1));

  -- 4. an admin holds every permission
  perform pg_temp.rec('an admin approves the pharmacy refund', 'ok',
    pg_temp.as_msg(v_admin, format('select public.approve_pharmacy_order_refund(%L)', v_ph1)));
  perform pg_temp.rec('...and it is approved with a journal entry', 'approved,true',
    (select status::text || ',' || (journal_entry_id is not null)::text from public.pharmacy_order_refunds where id = v_ph1));
  perform pg_temp.rec('an approved refund cannot be approved twice', 'true',
    (pg_temp.as_msg(v_admin, format('select public.approve_pharmacy_order_refund(%L)', v_ph1)) like '23514:%')::text);

  -- 5. nothing else moved
  perform pg_temp.rec('raising a refund was not made finance-only', 'false',
    (pg_get_functiondef('public.request_lab_order_refund(uuid,public.lab_refund_reason,bigint,text)'::regprocedure) like '%finance.gl.post%')::text);
  perform pg_temp.rec('anon cannot execute either approve function', 'false,false',
    has_function_privilege('anon', 'public.approve_lab_order_refund(uuid)', 'EXECUTE')::text || ',' || has_function_privilege('anon', 'public.approve_pharmacy_order_refund(uuid)', 'EXECUTE')::text);
end $$;

-- 6. SABOTAGE: switch the new check off in the function text; the care team can approve again, so the refusals must flip.
do $$
declare v_def text; v_org uuid := pg_temp.f('org'); v_coord uuid := pg_temp.f('coord'); v_clin uuid := pg_temp.f('clin'); v_l uuid; v_p uuid;
begin
  v_def := pg_get_functiondef('public.approve_lab_order_refund(uuid)'::regprocedure);
  v_def := replace(v_def, 'if not private.has_permission(''finance.gl.post'') then', 'if false then');
  execute v_def;
  v_def := pg_get_functiondef('public.approve_pharmacy_order_refund(uuid)'::regprocedure);
  v_def := replace(v_def, 'if not private.has_permission(''finance.gl.post'') then', 'if false then');
  execute v_def;
  v_l := pg_temp.lab_refund(v_org, pg_temp.f('pat'));
  v_p := pg_temp.pharm_refund(v_org, pg_temp.f('pat'));
  insert into results values ('sabotaged', 'a care coordinator is refused on the lab refund, by the finance check', 'true',
    (pg_temp.as_msg(v_coord, format('select public.approve_lab_order_refund(%L)', v_l)) like '42501:%needs finance authority%')::text);
  insert into results values ('sabotaged', 'a clinician is refused on the pharmacy refund', 'true',
    (pg_temp.as_msg(v_clin, format('select public.approve_pharmacy_order_refund(%L)', v_p)) like '42501:%needs finance authority%')::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'OQ-580 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
  from results order by phase desc, check_name;

rollback;
