-- Tarragon Health
-- Proves the availability-awareness added to private.auto_match_internal_
-- specialist() by 20260916005747_escalation_auto_assignment_respects_
-- availability.sql -- the specialist-referral sibling of
-- escalation_auto_assignment_respects_availability.sql's coverage of
-- private.auto_assign_escalation():
--   1. a specialist on genuine leave (provider_time_off.kind = 'leave'
--      covering now()) is excluded OUTRIGHT, even with the lowest referral
--      load of anyone qualifying;
--   2. a specialist with an ad-hoc 'blocked' slot right now, or whose only
--      configured provider_availability_rules window has already expired
--      (deterministic stand-in for "outside declared hours"), is only
--      DEPRIORITISED -- still gets the referral when nobody better
--      qualifies;
--   3. a specialist with zero provider_availability_rules configured is
--      never penalised for that (fail open).
--
-- No continuity case here (unlike the escalation test) -- referral matching
-- has no analogue to an already-owned clinician_alert; each unmatched
-- referral is matched fresh at insert time.
--
-- Every fixture doctor gets its OWN clinical_staff.specialist_type (one per
-- case group: cardiology / oncologist / endocrinology / nephrology) rather
-- than reactivating/deactivating clinical_staff rows between cases --
-- private.auto_match_internal_specialist() scopes its candidate query to
-- (organisation_id, active, specialist_type = new.specialist_type), so
-- giving each case group a distinct specialist_type is sufficient isolation
-- on its own, with no cross-case contamination to guard against.
--
-- specialist_referrals is gated by private.enforce_specialist_referral_create()
-- (private.is_clinical_tier -- an active medical_officer+ of the patient's
-- own org, checked via auth.uid()), so every insert below runs under a
-- minted referring clinician's request.jwt.claims, exactly like
-- referral_management_engine.sql's existing coverage of that same gate.
--
-- Run: npx supabase db query --linked -f packages/db/tests/specialist_referral_auto_match_respects_availability.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temp table test_result (case_num int, label text, outcome text, detail text) on commit drop;
create temp table ids (k text primary key, v uuid) on commit drop;

do $$
declare
  v_org uuid := gen_random_uuid();
  v_id  uuid;
  r     record;
begin
  insert into public.organisations (id, name, type)
  values (v_org, 'Specialist Referral Availability Test Org', 'clinic');
  insert into ids(k, v) values ('org', v_org);

  for r in select * from (values ('patient_1'), ('patient_2'), ('patient_3')) as t(key_name)
  loop
    v_id := gen_random_uuid();
    insert into ids(k, v) values (r.key_name, v_id);
    insert into auth.users (id, email) values (v_id, format('specavail-%s@example.invalid', r.key_name));
    insert into public.profiles (id, organisation_id, role, full_name)
    values (v_id, v_org, 'patient'::public.user_role, format('Specialist Availability %s', r.key_name))
    on conflict (id) do update
      set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  end loop;

  -- doctor_referrer: creates every referral below (medical_officer, no
  -- specialist_type of its own -- just the clinical-tier author).
  -- specialist_onleave / specialist_loaded (cardiology): case 1.
  -- specialist_blocked / specialist_free (oncologist): case 2a.
  -- specialist_onlyblocked (endocrinology): case 2b.
  -- specialist_expiredrule / specialist_norules (nephrology): case 3.
  for r in select * from (values
      ('doctor_referrer', 'medical_officer', null),
      ('specialist_onleave', 'senior_medical_officer', 'cardiology'),
      ('specialist_loaded', 'senior_medical_officer', 'cardiology'),
      ('specialist_blocked', 'senior_medical_officer', 'oncologist'),
      ('specialist_free', 'senior_medical_officer', 'oncologist'),
      ('specialist_onlyblocked', 'senior_medical_officer', 'endocrinology'),
      ('specialist_expiredrule', 'senior_medical_officer', 'nephrology'),
      ('specialist_norules', 'senior_medical_officer', 'nephrology')
    ) as t(key_name, tier, spec_type)
  loop
    v_id := gen_random_uuid();
    insert into ids(k, v) values (r.key_name, v_id);
    insert into auth.users (id, email) values (v_id, format('specavail-%s@example.invalid', r.key_name));
    insert into public.profiles (id, organisation_id, role, full_name)
    values (v_id, v_org, 'clinician'::public.user_role, format('Dr Specialist Availability %s', r.key_name))
    on conflict (id) do update
      set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

    insert into public.clinical_staff (
      organisation_id, profile_id, full_name, active, license_verified_at,
      doctor_tier, employment_type, specialist_type,
      indemnity_insurer, indemnity_policy_number, indemnity_expires_at
    )
    values (
      v_org, v_id, format('Dr Specialist Availability %s', r.key_name), true, now(),
      r.tier::public.doctor_tier, 'employed', r.spec_type::public.specialist_type,
      'Probe Indemnity Ltd', format('PROBE-SPECAVAIL-%s', r.key_name), now() + interval '1 year'
    )
    returning id into v_id;
    insert into ids(k, v) values (r.key_name || '_staff', v_id);
  end loop;

  insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at, reason)
  values (v_org, (select v from ids where k = 'specialist_onleave'), 'leave', now() - interval '1 hour', now() + interval '1 hour', 'Test: annual leave covering now');

  insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at, reason)
  values (v_org, (select v from ids where k = 'specialist_blocked'), 'blocked', now() - interval '15 minutes', now() + interval '15 minutes', 'Test: ad-hoc blocked slot covering now');

  insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at, reason)
  values (v_org, (select v from ids where k = 'specialist_onlyblocked'), 'blocked', now() - interval '10 minutes', now() + interval '10 minutes', 'Test: blocked, but must still be chosen when nobody else qualifies');

  -- Deterministic "outside declared hours": is_active but effective_until
  -- already expired.
  insert into public.provider_availability_rules (
    organisation_id, clinician_id, day_of_week, start_time, end_time,
    consultation_method, appointment_types, effective_from, effective_until, is_active
  )
  values (
    v_org, (select v from ids where k = 'specialist_expiredrule'), 1, '09:00', '17:00',
    'telemedicine', array['specialist']::public.appointment_type[],
    current_date - 30, current_date - 1, true
  );
end $$;

-- ---------------------------------------------------------------------------
-- Case 1: leave hard-excludes even though the on-leave specialist has the
-- lowest referral load. specialist_loaded is given a pre-existing referral
-- (direct-assigned, bypassing matching) so its load is 1; specialist_onleave
-- stays at load 0. Without the fix, the least-loaded specialist
-- (specialist_onleave) would win the fresh referral below.
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k = 'doctor_referrer'), 'role', 'authenticated')::text, true);

  insert into public.specialist_referrals (organisation_id, patient_id, specialist_type, referral_reason, assigned_specialist_id, fulfilment)
  values (
    (select v from ids where k = 'org'), (select v from ids where k = 'patient_1'), 'cardiology',
    'Pre-existing load for specialist_loaded', (select v from ids where k = 'specialist_loaded_staff'), 'partner'
  );

  insert into public.specialist_referrals (organisation_id, patient_id, specialist_type, referral_reason)
  values (
    (select v from ids where k = 'org'), (select v from ids where k = 'patient_1'), 'cardiology',
    'Case 1: must skip the on-leave specialist despite their lower load'
  );

  perform set_config('request.jwt.claims', '', true);
end $$;

insert into test_result
select 1, 'on-leave specialist is excluded outright even with the lowest referral load',
  case when sr.assigned_specialist_id = (select v from ids where k = 'specialist_loaded_staff')
        and sr.fulfilment = 'partner'
       then 'PASS' else 'FAIL' end,
  'assigned_specialist_id=' || coalesce(sr.assigned_specialist_id::text, 'null') || ' fulfilment=' || sr.fulfilment::text
from public.specialist_referrals sr
where sr.patient_id = (select v from ids where k = 'patient_1')
  and sr.referral_reason = 'Case 1: must skip the on-leave specialist despite their lower load';

-- ---------------------------------------------------------------------------
-- Case 2a: a currently-blocked specialist loses a tied tie-break (both load
-- 0) against an unblocked specialist of the same specialist_type.
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k = 'doctor_referrer'), 'role', 'authenticated')::text, true);

  insert into public.specialist_referrals (organisation_id, patient_id, specialist_type, referral_reason)
  values (
    (select v from ids where k = 'org'), (select v from ids where k = 'patient_2'), 'oncologist',
    'Case 2a: tied load, must prefer the unblocked specialist'
  );

  perform set_config('request.jwt.claims', '', true);
end $$;

insert into test_result
select 2, 'blocked-right-now specialist loses a tied-load tie-break to a free specialist',
  case when sr.assigned_specialist_id = (select v from ids where k = 'specialist_free_staff') then 'PASS' else 'FAIL' end,
  'assigned_specialist_id=' || coalesce(sr.assigned_specialist_id::text, 'null')
from public.specialist_referrals sr
where sr.patient_id = (select v from ids where k = 'patient_2')
  and sr.referral_reason = 'Case 2a: tied load, must prefer the unblocked specialist';

-- ---------------------------------------------------------------------------
-- Case 2b: soft signal, not exclusion -- specialist_onlyblocked is the ONLY
-- active endocrinology-credentialed specialist in this org, and is blocked
-- right now. Must still receive the referral.
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k = 'doctor_referrer'), 'role', 'authenticated')::text, true);

  insert into public.specialist_referrals (organisation_id, patient_id, specialist_type, referral_reason)
  values (
    (select v from ids where k = 'org'), (select v from ids where k = 'patient_2'), 'endocrinology',
    'Case 2b: the only endocrinology specialist is blocked but must still get the referral'
  );

  perform set_config('request.jwt.claims', '', true);
end $$;

insert into test_result
select 3, 'blocked specialist still receives the referral when nobody else qualifies (soft signal, not exclusion)',
  case when sr.assigned_specialist_id = (select v from ids where k = 'specialist_onlyblocked_staff') then 'PASS' else 'FAIL' end,
  'assigned_specialist_id=' || coalesce(sr.assigned_specialist_id::text, 'null')
from public.specialist_referrals sr
where sr.patient_id = (select v from ids where k = 'patient_2')
  and sr.referral_reason = 'Case 2b: the only endocrinology specialist is blocked but must still get the referral';

-- ---------------------------------------------------------------------------
-- Case 3: fail-open tie-break. specialist_expiredrule has configured
-- provider_availability_rules, but the only row is deterministically
-- outside its effective range -- deprioritised. specialist_norules has
-- never configured any rule at all -- must win the tie (both load 0).
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k = 'doctor_referrer'), 'role', 'authenticated')::text, true);

  insert into public.specialist_referrals (organisation_id, patient_id, specialist_type, referral_reason)
  values (
    (select v from ids where k = 'org'), (select v from ids where k = 'patient_3'), 'nephrology',
    'Case 3: expired-rule specialist deprioritised behind the specialist with no rules configured at all'
  );

  perform set_config('request.jwt.claims', '', true);
end $$;

insert into test_result
select 4, 'a specialist with an expired/non-matching availability rule loses the tie-break to a specialist with no rules configured (fail-open)',
  case when sr.assigned_specialist_id = (select v from ids where k = 'specialist_norules_staff') then 'PASS' else 'FAIL' end,
  'assigned_specialist_id=' || coalesce(sr.assigned_specialist_id::text, 'null')
from public.specialist_referrals sr
where sr.patient_id = (select v from ids where k = 'patient_3')
  and sr.referral_reason = 'Case 3: expired-rule specialist deprioritised behind the specialist with no rules configured at all';

-- ---------------------------------------------------------------------------
-- Verdict.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg('case ' || case_num || ' (' || label || '): ' || detail, '; ' order by case_num)
    into v_bad
  from test_result
  where outcome not like 'PASS%';

  if v_bad is not null then
    raise exception 'SPECIALIST REFERRAL AUTO-MATCH AVAILABILITY-AWARENESS BROKEN: %', v_bad;
  end if;
end $$;

select case_num, label, outcome, detail from test_result order by case_num;

rollback;
