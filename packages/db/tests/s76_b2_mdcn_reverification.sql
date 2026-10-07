-- S76 B2 proof: MDCN re-verification (migration *_s76_mdcn_reverification.sql).
--   1. Config v3 exists and is NOT active; with the cadence inactive the sweep is inert and suspends nobody.
--   2. Recording a check: reviewer only, never about yourself, append only, evidence or notes required, date and result validated.
--   3. A not-found result pauses access through the existing suspension function.
--   4. With the cadence activated: overdue is noticed once and suspended; inside an audited LICENCE grace period it is noticed but
--      not suspended; due soon is noticed once and kept; a recorded check moves the due date and keeps the clinician.
--   5. RLS: another clinician and anon see nothing and cannot record.
--   6. SABOTAGE: with the grace check removed from the sweep the clinician the real code spared is suspended.
begin;
create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's76b2-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S76B2 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '35 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_cmo_staff uuid; v_a uuid; v_a_s uuid; v_b uuid; v_b_s uuid; v_c uuid; v_c_s uuid; v_d uuid; v_d_s uuid; v_e uuid; v_e_s uuid; v_other uuid;
  v_res jsonb; v_id uuid; v_n integer; v_old_def text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  v_a := pg_temp.mkuser(v_org, 'overdue', 'clinician');
  v_b := pg_temp.mkuser(v_org, 'grace', 'clinician');
  v_c := pg_temp.mkuser(v_org, 'soon', 'clinician');
  v_d := pg_temp.mkuser(v_org, 'checked', 'clinician');
  v_e := pg_temp.mkuser(v_org, 'notfound', 'clinician');
  v_other := pg_temp.mkuser(v_org, 'other', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org, v_cmo, 'S76B2 CMO', 'MDCN', 'S76B2-CMO', true, 'active', now(), v_admin, 'chief_medical_officer', 'contracted', 2, true, v_admin, true) returning id into v_cmo_staff;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
    values (v_org, v_a, 'S76B2 Overdue', 'MDCN', 'S76B2-A', true, 'active', now() - interval '400 days', v_admin, 'senior_medical_officer', 'employed', 2, true) returning id into v_a_s;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
    values (v_org, v_b, 'S76B2 Grace', 'MDCN', 'S76B2-B', true, 'active', now() - interval '400 days', v_admin, 'senior_medical_officer', 'employed', 2, true) returning id into v_b_s;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
    values (v_org, v_c, 'S76B2 Soon', 'MDCN', 'S76B2-C', true, 'active', now() - interval '350 days', v_admin, 'senior_medical_officer', 'employed', 2, true) returning id into v_c_s;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
    values (v_org, v_d, 'S76B2 Checked', 'MDCN', 'S76B2-D', true, 'active', now() - interval '400 days', v_admin, 'senior_medical_officer', 'employed', 2, true) returning id into v_d_s;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
    values (v_org, v_e, 'S76B2 NotFound', 'MDCN', 'S76B2-E', true, 'active', now(), v_admin, 'senior_medical_officer', 'employed', 2, true) returning id into v_e_s;
  -- clinical_staff.created_at is the baseline when no licence date is older; push the record back so "overdue" is real
  update public.clinical_staff set created_at = now() - interval '420 days' where id in (v_a_s, v_b_s, v_d_s);
  update public.clinical_staff set created_at = now() - interval '350 days' where id = v_c_s;

  -- 1. config proposed, sweep inert
  perform pg_temp.rec('config v3 exists', '1', (select count(*)::text from public.credentialing_config where version = 3));
  perform pg_temp.rec('config v3 is not active', 'false', (select is_active::text from public.credentialing_config where version = 3));
  v_res := private.licence_reverification_sweep();
  perform pg_temp.rec('inert sweep reports inert', 'true', coalesce(v_res ->> 'inert', 'false'));
  perform pg_temp.rec('inert sweep suspended nobody', '0', (select count(*)::text from public.clinical_staff where id in (v_a_s, v_b_s, v_c_s, v_d_s) and status <> 'active'));

  -- 2. recording
  perform pg_temp.act(v_other);
  perform pg_temp.rec('a clinician cannot record', '42501', pg_temp.try(format('select public.record_licence_verification(%L, %L, %L, null, null, null, %L)', v_d_s, 'S76B2-D', 'good_standing', 'looked on the register')));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot record', '42501', pg_temp.try(format('select public.record_licence_verification(%L, %L, %L, null, null, null, %L)', v_d_s, 'S76B2-D', 'good_standing', 'looked on the register')));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('no evidence and no notes is refused', '23514', pg_temp.try(format('select public.record_licence_verification(%L, %L, %L)', v_d_s, 'S76B2-D', 'good_standing')));
  perform pg_temp.rec('an unknown result is refused', '23514', pg_temp.try(format('select public.record_licence_verification(%L, %L, %L, null, null, null, %L)', v_d_s, 'S76B2-D', 'fine', 'looked on the register')));
  perform pg_temp.rec('a future check date is refused', '23514', pg_temp.try(format('select public.record_licence_verification(%L, %L, %L, null, current_date + 3, null, %L)', v_d_s, 'S76B2-D', 'good_standing', 'looked on the register')));
  perform pg_temp.rec('a check of your own licence is refused', '42501', pg_temp.try(format('select public.record_licence_verification(%L, %L, %L, null, null, null, %L)', v_cmo_staff, 'S76B2-CMO', 'good_standing', 'looked on the register')));
  v_id := public.record_licence_verification(v_d_s, 'S76B2-D', 'good_standing', null, null, null, 'looked up name and folio on the register');
  perform pg_temp.back();
  perform pg_temp.rec('a check is recorded', '1', (select count(*)::text from public.clinician_licence_verifications where id = v_id));
  perform pg_temp.rec('next due is about 12 months out', 'true', (select (next_due between current_date + 360 and current_date + 370)::text from public.clinician_licence_verifications where id = v_id));
  perform pg_temp.rec('the check is audited', '1', (select count(*)::text from public.audit_log where action = 'clinician_licence.verified' and entity_id = v_d_s));
  perform pg_temp.rec('a verification cannot be updated', '23514', pg_temp.try(format('update public.clinician_licence_verifications set folio = %L where id = %L', 'x', v_id)));
  perform pg_temp.rec('a verification cannot be deleted', '23514', pg_temp.try(format('delete from public.clinician_licence_verifications where id = %L', v_id)));

  -- 3. not found pauses access
  perform pg_temp.act(v_admin);
  perform public.record_licence_verification(v_e_s, 'S76B2-E', 'not_found', null, null, null, 'searched by name and folio, not listed');
  perform pg_temp.back();
  perform pg_temp.rec('not found pauses access', 'suspended', (select status::text from public.clinical_staff where id = v_e_s));

  -- 4. activate the cadence (what the CMO sign-off will do) and sweep
  update public.credentialing_config set is_active = false where is_active;
  update public.credentialing_config set is_active = true where version = 3;
  insert into public.credential_grace_periods (organisation_id, clinical_staff_id, kind, starts_at, ends_at, reason, granted_by, is_test)
    values (v_org, v_b_s, 'licence', now() - interval '1 day', now() + interval '5 days', 'S76B2 grace for the proof', v_cmo, true);
  v_res := private.licence_reverification_sweep();
  perform pg_temp.rec('overdue clinician is suspended', 'suspended', (select status::text from public.clinical_staff where id = v_a_s));
  perform pg_temp.rec('clinician in licence grace is spared', 'active', (select status::text from public.clinical_staff where id = v_b_s));
  perform pg_temp.rec('clinician due soon is kept', 'active', (select status::text from public.clinical_staff where id = v_c_s));
  perform pg_temp.rec('clinician with a recorded check is kept', 'active', (select status::text from public.clinical_staff where id = v_d_s));
  perform pg_temp.rec('overdue notices: overdue and grace', '2', (select count(*)::text from public.licence_reverification_notices where clinical_staff_id in (v_a_s, v_b_s) and stage = 'overdue'));
  perform pg_temp.rec('due-soon notice for the soon clinician', '1', (select count(*)::text from public.licence_reverification_notices where clinical_staff_id = v_c_s and stage = 'due_soon'));
  perform pg_temp.rec('no notice for the checked clinician', '0', (select count(*)::text from public.licence_reverification_notices where clinical_staff_id = v_d_s));
  select count(*) into v_n from public.notifications where payload ->> 'kind' = 'licence_reverification';
  v_res := private.licence_reverification_sweep();
  perform pg_temp.rec('a second sweep adds no notices', v_n::text, (select count(*)::text from public.notifications where payload ->> 'kind' = 'licence_reverification'));
  perform pg_temp.rec('the suspension reason is recorded', '1', (select count(*)::text from public.clinical_staff where id = v_a_s and suspended_reason like '%register check was due%'));

  -- 5. RLS
  perform pg_temp.act(v_other);
  select count(*) into v_n from public.clinician_licence_verifications;
  perform pg_temp.back();
  perform pg_temp.rec('another clinician sees no verifications', '0', v_n::text);
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot read verifications', '42501', pg_temp.try('select count(*) from public.clinician_licence_verifications'));
  perform pg_temp.back();

  -- 6. SABOTAGE: take the grace check out of the sweep; the spared clinician must now be suspended
  select pg_get_functiondef('private.licence_reverification_sweep()'::regprocedure) into v_old_def;
  execute replace(v_old_def, 'if not private.credential_in_grace(r.id, ''licence'') then', 'if true then');
  update public.clinical_staff set status = 'active', active = true, suspended_at = null where id = v_b_s;  -- fixture reset
  delete from public.licence_reverification_notices where clinical_staff_id = v_b_s;
  perform private.licence_reverification_sweep();
  insert into results values ('sabotaged', 'grace clinician is spared', 'active', (select status::text from public.clinical_staff where id = v_b_s));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S76 B2 proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then raise exception 'VACUOUS TEST: removing the grace check did not change the outcome'; end if;
end $$;
select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
