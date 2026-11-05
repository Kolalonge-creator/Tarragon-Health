-- Consent proof (T2-01/T2-09/T2-13, 20261105130954_consent_remove_membership_plus_v3.sql): terms_of_service and telehealth
-- each have exactly one current version, 2026-11-05-v3, and neither current body names Membership Plus; the 2026-10-30-v2 rows
-- stay as superseded history; data_processing is untouched at 2026-10-30-v2. A patient who accepted only the v2 rows has
-- outstanding required consents (the bump asks everyone to accept again), and accepting v3 closes the gap.
-- Own fixtures; BEGIN/ROLLBACK; a sabotage step at the end.
begin;

do $$
declare
  v_org uuid;
  v_p uuid := gen_random_uuid();
  v_tos_v3 uuid; v_tele_v3 uuid; v_tos_v2 uuid; v_tele_v2 uuid;
  v_n int;
begin
  -- 1. one current row per type, at v3, with no Membership Plus
  select count(*) into v_n from public.consent_versions where consent_type = 'terms_of_service' and is_current;
  if v_n <> 1 then raise exception 'FAIL: % current terms_of_service rows', v_n; end if;
  select count(*) into v_n from public.consent_versions where consent_type = 'telehealth' and is_current;
  if v_n <> 1 then raise exception 'FAIL: % current telehealth rows', v_n; end if;

  select id into v_tos_v3 from public.consent_versions where consent_type = 'terms_of_service' and is_current and version = '2026-11-05-v3';
  select id into v_tele_v3 from public.consent_versions where consent_type = 'telehealth' and is_current and version = '2026-11-05-v3';
  if v_tos_v3 is null or v_tele_v3 is null then raise exception 'FAIL: terms_of_service or telehealth is not current at 2026-11-05-v3'; end if;

  if exists (select 1 from public.consent_versions
              where is_current and consent_type in ('terms_of_service', 'telehealth')
                and body ~* '(membership plus|blood test|blood panel|moving up|moved up)') then
    raise exception 'FAIL: a current terms_of_service or telehealth body still names the retired Membership Plus';
  end if;
  if (select body from public.consent_versions where id = v_tos_v3) not like '%There are two plans.%'
     or (select body from public.consent_versions where id = v_tos_v3) not like '%Laboratory tests are not included in Membership.%'
     or (select body from public.consent_versions where id = v_tos_v3) not like '%21-day refund%' then
    raise exception 'FAIL: the v3 terms body is missing its two-plan, laboratory or refund wording';
  end if;

  -- 2. history kept; data_processing untouched
  select id into v_tos_v2 from public.consent_versions where consent_type = 'terms_of_service' and version = '2026-10-30-v2' and not is_current;
  select id into v_tele_v2 from public.consent_versions where consent_type = 'telehealth' and version = '2026-10-30-v2' and not is_current;
  if v_tos_v2 is null or v_tele_v2 is null then raise exception 'FAIL: the superseded 2026-10-30-v2 rows are missing'; end if;
  if not exists (select 1 from public.consent_versions where consent_type = 'data_processing' and is_current and version = '2026-10-30-v2') then
    raise exception 'FAIL: data_processing was republished or disturbed';
  end if;

  -- 3. a patient who accepted only v2 must accept again; v3 closes the gap
  select id into v_org from public.organisations limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_p, 'consent-v3@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Consent V3', is_test = false where id = v_p;

  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, created_at)
  select v_org, v_p, cv.consent_type, cv.id, cv.version, 'accepted', now() - interval '5 minutes'
    from public.consent_versions cv
   where (cv.is_current and not cv.is_optional and cv.consent_type not in ('terms_of_service', 'telehealth'))
      or cv.id in (v_tos_v2, v_tele_v2);
  if private.has_required_consents(v_p) then
    raise exception 'FAIL: a v2 acceptance still counts as in force after the v3 bump';
  end if;

  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, created_at)
  select v_org, v_p, cv.consent_type, cv.id, cv.version, 'accepted', now() - interval '1 minute'
    from public.consent_versions cv where cv.id in (v_tos_v3, v_tele_v3);
  if not private.has_required_consents(v_p) then
    raise exception 'FAIL: accepting v3 did not put the required consents back in force';
  end if;
  raise notice 'PASS: one current v3 per type, no Membership Plus, v2 kept as history, data_processing untouched, v2 acceptance must be renewed';

  -- SABOTAGE: put the v2 terms back as current; the "no Membership Plus in a current body" check must now catch it.
  update public.consent_versions set is_current = false where id = v_tos_v3;
  update public.consent_versions set is_current = true where id = v_tos_v2;
  if not exists (select 1 from public.consent_versions
                  where is_current and consent_type in ('terms_of_service', 'telehealth')
                    and body ~* '(membership plus|blood test|blood panel|moving up|moved up)') then
    raise exception 'sabotage: the v2 terms are current again but the check did not see Membership Plus, so the test would not discriminate';
  end if;
  raise notice 'PASS: sabotage confirmed';
end $$;

rollback;
