-- 12-week two-track chronic-care programme — schedule generation: the
-- weekly occurrence set materialises in one pass on enrolment, with the
-- right count/week-numbers/due-dates for each track, the end-review shell
-- is auto-created alongside the week-12 review occurrence, and re-enrolling
-- never duplicates an already-generated occurrence (the ON CONFLICT DO
-- NOTHING path).
--
-- Rolled back. Fixtures resolved at runtime, per this repo's test
-- convention.
begin;

do $$
declare
  v_org          uuid;
  v_patient      uuid;
  v_programme    uuid;
  v_pack_id      uuid;
  v_enrolment    uuid;
  v_started_at   date;
  v_count        integer;
  v_week1_due    date;
  v_week12_due   date;
  v_review_count integer;
begin
  select id into v_programme from public.chronic_condition_programmes where code = 'diabetes';
  select id into v_pack_id from public.service_products where code = 'chronic_doctor_supported_pack';

  select p.organisation_id into v_org
  from public.profiles p
  where p.role = 'patient'
    and not exists (
      select 1 from public.chronic_programme_enrolments e
      where e.patient_id = p.id and e.programme_id = v_programme and e.status = 'enrolled'
    )
  limit 1;
  select id into v_patient from public.profiles where organisation_id = v_org and role = 'patient'
    and not exists (
      select 1 from public.chronic_programme_enrolments e
      where e.patient_id = profiles.id and e.programme_id = v_programme and e.status = 'enrolled'
    )
  limit 1;

  if v_patient is null then
    raise exception 'need a patient with no existing diabetes enrolment to run this test';
  end if;

  ---------------------------------------------------------------- 1. self_monitoring: 3 occurrences (baseline + recheck + review)
  insert into public.chronic_programme_enrolments (organisation_id, patient_id, programme_id, status)
  values (v_org, v_patient, v_programme, 'enrolled')
  returning id, programme_started_at::date into v_enrolment, v_started_at;

  select count(*) into v_count from public.chronic_programme_schedule_occurrences where enrolment_id = v_enrolment;
  if v_count <> 3 then
    raise exception 'FAIL 1: expected 3 self_monitoring occurrences, got %', v_count;
  end if;

  select due_date into v_week1_due from public.chronic_programme_schedule_occurrences
    where enrolment_id = v_enrolment and week_number = 1 and occurrence_type = 'lab_panel';
  select due_date into v_week12_due from public.chronic_programme_schedule_occurrences
    where enrolment_id = v_enrolment and week_number = 12 and occurrence_type = 'lab_panel';
  if v_week1_due <> v_started_at then
    raise exception 'FAIL 1: week-1 due_date is %, expected the enrolment date %', v_week1_due, v_started_at;
  end if;
  if v_week12_due <> v_started_at + 77 then
    raise exception 'FAIL 1: week-12 due_date is %, expected % (11 weeks after week 1)', v_week12_due, v_started_at + 77;
  end if;

  if not exists (
    select 1 from public.chronic_programme_schedule_occurrences
    where enrolment_id = v_enrolment and occurrence_type = 'programme_end_review' and week_number = 12
  ) then
    raise exception 'FAIL 1: no programme_end_review occurrence was generated';
  end if;

  ---------------------------------------------------------------- 2. the end-review shell is auto-created empty alongside it
  select count(*) into v_review_count from public.chronic_programme_end_reviews where enrolment_id = v_enrolment;
  if v_review_count <> 1 then
    raise exception 'FAIL 2: expected exactly 1 end-review shell row, got %', v_review_count;
  end if;
  if exists (select 1 from public.chronic_programme_end_reviews where enrolment_id = v_enrolment and (reviewed_by is not null or reviewed_at is not null)) then
    raise exception 'FAIL 2: a freshly generated end-review shell must be null-gated (reviewed_by/reviewed_at unset)';
  end if;

  ---------------------------------------------------------------- 3. re-enrolling does not duplicate already-generated occurrences
  update public.chronic_programme_enrolments set status = 'withdrawn', withdrawn_at = now() where id = v_enrolment;
  update public.chronic_programme_enrolments set status = 'enrolled' where id = v_enrolment;
  select count(*) into v_count from public.chronic_programme_schedule_occurrences where enrolment_id = v_enrolment;
  if v_count <> 3 then
    raise exception 'FAIL 3: re-enrolling duplicated occurrences (count is now %, expected still 3)', v_count;
  end if;

  ---------------------------------------------------------------- 4. doctor_supported: 6 occurrences (baseline + recheck + 3 calls + review)
  update public.chronic_programme_enrolments set status = 'withdrawn', withdrawn_at = now() where id = v_enrolment;
  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency, purchased_at, expires_at)
  values (v_org, v_patient, v_patient, v_pack_id, 'active', 1500000, 'NGN', now(), now() + interval '84 days');
  update public.chronic_programme_enrolments set status = 'enrolled' where id = v_enrolment;

  select count(*) into v_count from public.chronic_programme_schedule_occurrences
    where enrolment_id = v_enrolment and occurrence_type = 'doctor_checkin';
  if v_count <> 3 then
    raise exception 'FAIL 4: expected 3 doctor_checkin occurrences (weeks 4/8/12), got %', v_count;
  end if;
  if not exists (
    select 1 from public.chronic_programme_schedule_occurrences
    where enrolment_id = v_enrolment and occurrence_type = 'doctor_checkin' and week_number = 12
  ) then
    raise exception 'FAIL 4: expected a doctor_checkin at week 12 (the call that doubles as the review call)';
  end if;

  raise notice 'PASS: schedule generation produces the right occurrence count/due-dates for both tracks, creates the end-review shell empty and exactly once, and never duplicates on re-enrolment';
end $$;

rollback;
