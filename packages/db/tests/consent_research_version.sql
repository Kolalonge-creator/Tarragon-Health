-- Consent proof (S83 audit 1.2, 1.4, 1.6): research has exactly one current optional version whose text matches what is gated; a patient
-- session can give it, and withdraw it, as append-only rows; the S81 eligibility test follows the consent state; a patient cannot write
-- another person's consent. Own fixtures; BEGIN/ROLLBACK; a sabotage step at the end.
begin;

do $$
declare
  v_org uuid; v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); v_dp uuid; v_res uuid; v_ver text; v_ok boolean; v_n int;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_dp from public.consent_versions where consent_type = 'data_processing' and is_current;
  select id, version into v_res, v_ver from public.consent_versions where consent_type = 'research' and is_current;
  if v_res is null then raise exception 'FAIL: no current research consent version'; end if;
  if (select count(*) from public.consent_versions where consent_type = 'research' and is_current) <> 1 then raise exception 'FAIL: more than one current research version'; end if;
  if not (select is_optional from public.consent_versions where id = v_res) then raise exception 'FAIL: research consent is not optional'; end if;
  if (select body from public.consent_versions where id = v_res) not like '%never sold or licensed%'
     or (select body from public.consent_versions where id = v_res) not like '%ethics committee%'
     or (select body from public.consent_versions where id = v_res) like '%—%' then
    raise exception 'FAIL: the research consent text does not say what is gated (or has an em dash)';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_a, 'cons-a@example.invalid','x',now(),'{}','{}'), (v_b, 'cons-b@example.invalid','x',now(),'{}','{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Consent A', is_test = false where id = v_a;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Consent B', is_test = false where id = v_b;

  -- nothing is recorded by the migration: neither patient starts with research consent
  if private.research_eligible(v_a) then raise exception 'FAIL: eligible with no consent at all'; end if;

  -- patient A, as a real session: accepts data_processing (required, given at onboarding) and then chooses research
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, created_at) select v_org, v_a, 'data_processing', v_dp, version, 'accepted', now() - interval '3 minutes' from public.consent_versions where id = v_dp;
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, created_at) values (v_org, v_a, 'research', v_res, v_ver, 'accepted', now() - interval '2 minutes');
  -- cannot write another person's consent
  begin insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, v_b, 'research', v_res, v_ver, 'accepted'); v_ok := true; exception when others then v_ok := false; end;
  reset role;
  if v_ok then raise exception 'FAIL: a patient wrote another patient''s consent'; end if;
  if not private.research_eligible(v_a) then raise exception 'FAIL: not eligible after giving both consents'; end if;
  if private.research_eligible(v_b) then raise exception 'FAIL: the other patient became eligible'; end if;

  -- withdrawal: append-only, takes effect, history stays
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, created_at) values (v_org, v_a, 'research', v_res, v_ver, 'withdrawn', now() - interval '1 minute');
  begin delete from public.patient_consents where patient_id = v_a and consent_type = 'research'; v_ok := true; exception when others then v_ok := false; end;
  reset role;
  if private.research_eligible(v_a) then raise exception 'FAIL: still eligible after withdrawing'; end if;
  select count(*) into v_n from public.patient_consents where patient_id = v_a and consent_type = 'research';
  if v_n <> 2 then raise exception 'FAIL: history was not kept (% research rows)', v_n; end if;
  if (select withdrawn_at from public.patient_consent_state where patient_id = v_a and consent_type_code = 'research') is null then raise exception 'FAIL: state does not show the withdrawal'; end if;
  raise notice 'PASS: one optional research version, give and withdraw as append-only rows, eligibility follows, no cross-patient write';

  -- SABOTAGE: an eligibility test that ignores withdrawal would still count patient A
  create or replace function private.research_eligible(p_patient uuid, p_protocol uuid default null) returns boolean language sql stable security definer set search_path = '' as $f$
    select exists (select 1 from public.patient_consents c where c.patient_id = p_patient and c.consent_type = 'research' and c.action = 'accepted')
  $f$;
  if not private.research_eligible(v_a) then raise exception 'sabotage did not count the withdrawn patient, the test would not discriminate'; end if;
  raise notice 'PASS: sabotage confirmed';
end $$;

rollback;
