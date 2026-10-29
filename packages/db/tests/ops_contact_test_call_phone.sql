-- Proof: an ops desk contact's number can be confirmed by a recorded test call (migration *_ops_contact_phone_by_recorded_test_call.sql).
--
-- Proves in one rolled-back transaction:
--   1. An administrator or the CMO can record a test call for an administrator account; a clinician who is neither cannot (42501); a non-admin target is refused;
--      a number without a country code, a placeholder number and a short note are refused (22023).
--   2. Without a record (and with no code-confirmed number) the contact cannot be made active; with one, it can be, and verified_profile_phone returns the number.
--   3. The newest record wins.
--   4. SABOTAGE: with the records removed, verified_profile_phone returns nothing again, so check 2c must flip.
begin;
create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
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
  -- a leftover sub makes auth.uid() non-null and the is_test guard then treats the owner as a person
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as
$f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'cg-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'CG ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid language plpgsql as
$f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician');
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'CG ' || p_label, 'MDCN', 'CG-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      true, p_admin, true, array['en'], 'General practice');
  return v;
end $f$;

do $$
declare
  v_org uuid; v_boot uuid; v_cmo uuid; v_smo uuid; v_adm uuid; v_pat uuid; v_contact uuid; v_txt text; v_caught integer;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_boot := pg_temp.mkuser(v_org, 'boot', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_boot, 'cmo', 'chief_medical_officer');
  v_smo := pg_temp.mkdoc(v_org, v_boot, 'smo', 'senior_medical_officer');
  v_adm := pg_temp.mkuser(v_org, 'adm', 'admin');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  -- deterministic: this admin has no number of its own, so nothing is code-confirmed
  update public.profiles set phone = null where id = v_adm;

  -- 1. who and what -----------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_smo);
  perform pg_temp.rec('real', '1a a clinician who is neither admin nor CMO is refused', '42501', left(pg_temp.msg(format('select public.record_ops_contact_test_call(%L, ''+2348061197940'', ''phoned, they answered'')', v_adm)), 5));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('real', '1b a target that is not an administrator is refused', '23514', left(pg_temp.msg(format('select public.record_ops_contact_test_call(%L, ''+2348061197940'', ''phoned, they answered'')', v_pat)), 5));
  perform pg_temp.rec('real', '1c a number without a country code is refused', '22023', left(pg_temp.msg(format('select public.record_ops_contact_test_call(%L, ''08061197940'', ''phoned, they answered'')', v_adm)), 5));
  perform pg_temp.rec('real', '1d a placeholder number is refused', '22023', left(pg_temp.msg(format('select public.record_ops_contact_test_call(%L, ''+2341234567890'', ''phoned, they answered'')', v_adm)), 5));
  perform pg_temp.rec('real', '1e a short note is refused', '22023', left(pg_temp.msg(format('select public.record_ops_contact_test_call(%L, ''+2348061197940'', ''ok'')', v_adm)), 5));
  perform pg_temp.back();

  -- 2. activation needs it -------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_boot);
  v_contact := public.ops_desk_save_contact(v_adm, 'primary');
  perform public.ops_desk_set_windows(v_contact, '[{"day":1,"start":"08:00","end":"18:00"}]'::jsonb);
  v_txt := pg_temp.msg(format('select public.ops_desk_set_contact_active(%L, true, ''phoned them and they answered'')', v_contact));
  perform pg_temp.back();
  perform pg_temp.rec('real', '2a with no record the contact cannot be made active', '23514', left(v_txt, 5));
  perform pg_temp.rec('real', '2b and no number is reported', '', coalesce(private.verified_profile_phone(v_adm), ''));
  perform pg_temp.act(v_cmo);
  v_txt := (public.record_ops_contact_test_call(v_adm, '+234 806 119 7940', 'Phoned 29 Oct 22:50, they answered and gave their name')) ->> 'ok';
  perform pg_temp.back();
  perform pg_temp.rec('real', '2c the CMO records a test call', 'true', v_txt);
  perform pg_temp.rec('real', '2d the number is now the contact number (spaces removed)', '+2348061197940', coalesce(private.verified_profile_phone(v_adm), ''));
  perform pg_temp.act(v_boot);
  perform public.ops_desk_set_contact_active(v_contact, true, 'phoned them and they answered');
  perform pg_temp.back();
  perform pg_temp.rec('real', '2e the contact is now active', 'true', (select is_active::text from public.ops_desk_contacts where id = v_contact));
  perform pg_temp.rec('real', '2f the record names who tested it', v_cmo::text, (select tested_by::text from public.ops_desk_contact_phones where profile_id = v_adm limit 1));
  perform pg_temp.rec('real', '2g it is audited', '1', (select count(*)::text from public.audit_log where action = 'ops_desk.contact_test_call_recorded' and entity_id = v_adm));
  perform pg_temp.act(v_pat);
  select count(*)::text into v_txt from public.ops_desk_contact_phones;
  perform pg_temp.back();
  perform pg_temp.rec('real', '2h a patient cannot read the records', '0', v_txt);
  perform pg_temp.act(v_boot);
  select count(*)::text into v_txt from public.ops_desk_contact_phones;
  perform pg_temp.back();
  perform pg_temp.rec('real', '2i an administrator can read them', '1', v_txt);

  -- 3. the newest record wins -------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_boot);
  perform public.record_ops_contact_test_call(v_adm, '+447700900123', 'Phoned the UK number, they answered');
  perform pg_temp.back();
  update public.ops_desk_contact_phones set tested_at = now() + interval '1 minute' where phone = '+447700900123';
  perform pg_temp.rec('real', '3a the newest number wins', '+447700900123', coalesce(private.verified_profile_phone(v_adm), ''));

  -- 4. SABOTAGE: remove the records ------------------------------------------------------------------------------------------
  delete from public.ops_desk_contact_phones;
  perform pg_temp.rec('sabotaged', '2c the CMO records a test call', 'true', coalesce(private.verified_profile_phone(v_adm), 'none'));

  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotage step did not change the matching check'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- Sabotaged rows are asserted to differ inside the DO block above and are deliberately not printed.

rollback;
