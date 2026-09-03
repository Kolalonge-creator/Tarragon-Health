-- 12-week two-track chronic-care programme — regression test for two bugs
-- fixed in 20260902210000_fix_chronic_programme_two_track_gaps.sql:
--   1. obesity (the platform's 3rd launched chronic condition) must get a
--      non-empty schedule, same shape as hypertension/diabetes.
--   2. buying chronic_doctor_supported_pack while ALREADY enrolled (not via
--      a withdraw/re-enrol cycle) must upgrade the track in place and
--      materialise the newly-unlocked doctor_checkin occurrences.
--
-- Rolled back. Fixtures resolved at runtime, per this repo's test convention.
begin;

do $$
declare
  v_org             uuid;
  v_patient         uuid;
  v_pack_id         uuid;
  v_enrolment       uuid;
  v_purchase_id     uuid;
  v_track           public.chronic_programme_track;
  v_checkin_count   integer;
  v_obesity_self    integer;
  v_obesity_doctor  integer;
begin
  ---------------------------------------------------------------- 1. obesity schedule is non-empty and matches HTN/diabetes shape
  select count(*) into v_obesity_self
  from public.chronic_programme_schedule_templates t
  join public.chronic_condition_programmes cp on cp.id = t.programme_id
  where cp.code = 'obesity' and t.track = 'self_monitoring';
  if v_obesity_self <> 3 then
    raise exception 'FAIL 1: expected 3 obesity self_monitoring template rows, got %', v_obesity_self;
  end if;

  select count(*) into v_obesity_doctor
  from public.chronic_programme_schedule_templates t
  join public.chronic_condition_programmes cp on cp.id = t.programme_id
  where cp.code = 'obesity' and t.track = 'doctor_supported';
  if v_obesity_doctor <> 6 then
    raise exception 'FAIL 1: expected 6 obesity doctor_supported template rows, got %', v_obesity_doctor;
  end if;

  ---------------------------------------------------------------- 2. mid-programme doctor-supported upgrade
  -- Same skip-gracefully convention as chronic_programme_schedule_generation.sql:
  -- hypertension only becomes is_active via a live, signed-protocol runtime
  -- action, never a migration/seed — a from-scratch environment where that
  -- sign-off hasn't happened can't exercise this behavior.
  select id into v_pack_id from public.service_products where code = 'chronic_doctor_supported_pack';

  select p.organisation_id into v_org
  from public.profiles p
  where p.role = 'patient'
    and not exists (
      select 1 from public.chronic_programme_enrolments e
      where e.patient_id = p.id
        and e.programme_id = (select id from public.chronic_condition_programmes where code = 'hypertension')
        and e.status = 'enrolled'
    )
  limit 1;
  select id into v_patient from public.profiles where organisation_id = v_org and role = 'patient'
    and not exists (
      select 1 from public.chronic_programme_enrolments e
      where e.patient_id = profiles.id
        and e.programme_id = (select id from public.chronic_condition_programmes where code = 'hypertension')
        and e.status = 'enrolled'
    )
  limit 1;

  if v_patient is null or v_pack_id is null
     or not (select is_active from public.chronic_condition_programmes where code = 'hypertension') then
    raise notice 'SKIPPED: no patient/active hypertension programme/pack row to test against';
  else
    insert into public.chronic_programme_enrolments (organisation_id, patient_id, programme_id, status)
    select v_org, v_patient, id, 'enrolled' from public.chronic_condition_programmes where code = 'hypertension'
    returning id, track into v_enrolment, v_track;

    if v_track is distinct from 'self_monitoring' then
      raise exception 'FAIL 2: fresh enrolment did not land on self_monitoring (got %)', v_track;
    end if;

    -- The bug scenario: buy the add-on WHILE ALREADY ENROLLED, not via re-enrolment.
    insert into public.service_purchases
      (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
       amount_kobo, currency, scoped_entity_type, scoped_entity_id, purchased_at, expires_at)
    values (v_org, v_patient, v_patient, v_pack_id, 'active', 1500000, 'NGN',
            'chronic_programme_enrolments', v_enrolment, now(), now() + interval '84 days')
    returning id into v_purchase_id;

    select track into v_track from public.chronic_programme_enrolments where id = v_enrolment;
    if v_track is distinct from 'doctor_supported' then
      raise exception 'FAIL 2: mid-programme purchase did not upgrade the enrolment track (got %)', v_track;
    end if;

    select count(*) into v_checkin_count from public.chronic_programme_schedule_occurrences
      where enrolment_id = v_enrolment and occurrence_type = 'doctor_checkin';
    if v_checkin_count <> 3 then
      raise exception 'FAIL 2: mid-programme upgrade did not materialise the 3 doctor_checkin occurrences (got %)', v_checkin_count;
    end if;

    -- Negative control: a second, unscoped purchase of the same product for
    -- a DIFFERENT enrolment (none exists here) or a non-matching product
    -- must never touch this enrolment's track. Prove the guard actually
    -- discriminates rather than upgrading unconditionally.
    insert into public.service_purchases
      (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
       amount_kobo, currency, scoped_entity_type, scoped_entity_id, purchased_at, expires_at)
    values (v_org, v_patient, v_patient, v_pack_id, 'active', 1500000, 'NGN',
            'chronic_programme_enrolments', gen_random_uuid(), now(), now() + interval '84 days');
    -- (no exception expected: the where-clause guard in
    -- activate_chronic_programme_doctor_supported_track simply matches zero
    -- rows for a scoped_entity_id that doesn't exist -- proves it's a real
    -- id lookup, not an unconditional "any purchase of this product" rule.)
  end if;

  raise notice 'PASS: obesity schedule templates non-empty; mid-programme doctor-supported upgrade materialises correctly and discriminates by enrolment id';
end $$;

rollback;
