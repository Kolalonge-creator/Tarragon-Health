-- 12-week two-track chronic-care programme — track derivation invariants:
-- self_monitoring is the default, doctor_supported only follows a real
-- active chronic_doctor_supported_pack purchase, track is server-derived
-- and immutable to client input, and the 12-week window is set once and
-- never moves on a later update.
--
-- Rolled back. Fixtures resolved at runtime, per this repo's test
-- convention — see packages/db/tests/appointment_engine_core.sql for the
-- same shape.
begin;

do $$
declare
  v_org         uuid;
  v_patient     uuid;
  v_programme   uuid;
  v_pack_id     uuid;
  v_enrolment   uuid;
  v_track       public.chronic_programme_track;
  v_started_at  timestamptz;
  v_ends_at     timestamptz;
begin
  select id into v_programme from public.chronic_condition_programmes where code = 'hypertension';
  if v_programme is null then
    raise exception 'need an active hypertension programme row to run this test';
  end if;
  select id into v_pack_id from public.service_products where code = 'chronic_doctor_supported_pack';
  if v_pack_id is null then
    raise exception 'need the chronic_doctor_supported_pack service product to run this test';
  end if;

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
    raise exception 'need a patient with no existing hypertension enrolment to run this test';
  end if;

  ---------------------------------------------------------------- 1. default track is self_monitoring
  insert into public.chronic_programme_enrolments (organisation_id, patient_id, programme_id, status)
  values (v_org, v_patient, v_programme, 'enrolled')
  returning id, track, programme_started_at, programme_ends_at into v_enrolment, v_track, v_started_at, v_ends_at;

  if v_track <> 'self_monitoring' then
    raise exception 'FAIL 1: a patient with no service purchase got track=%, expected self_monitoring', v_track;
  end if;
  if v_started_at is null or v_ends_at is null then
    raise exception 'FAIL 1: programme window was not set on enrolment';
  end if;
  if v_ends_at <> v_started_at + interval '12 weeks' then
    raise exception 'FAIL 1: programme_ends_at is not exactly 12 weeks after programme_started_at';
  end if;

  ---------------------------------------------------------------- 2. client cannot set track directly
  update public.chronic_programme_enrolments set track = 'doctor_supported' where id = v_enrolment;
  select track into v_track from public.chronic_programme_enrolments where id = v_enrolment;
  if v_track <> 'self_monitoring' then
    raise exception 'FAIL 2: a plain UPDATE of track to doctor_supported was not rejected/ignored (got %)', v_track;
  end if;

  ---------------------------------------------------------------- 3. re-enrolling after withdrawal derives doctor_supported once the pack is active
  update public.chronic_programme_enrolments
    set status = 'withdrawn', withdrawn_at = now()
    where id = v_enrolment;

  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency, purchased_at, expires_at)
  values (v_org, v_patient, v_patient, v_pack_id, 'active', 1500000, 'NGN', now(), now() + interval '84 days');

  update public.chronic_programme_enrolments set status = 'enrolled' where id = v_enrolment;
  select track, programme_started_at into v_track, v_started_at from public.chronic_programme_enrolments where id = v_enrolment;
  if v_track <> 'doctor_supported' then
    raise exception 'FAIL 3: re-enrolling with an active chronic_doctor_supported_pack got track=%, expected doctor_supported', v_track;
  end if;

  ---------------------------------------------------------------- 4. an expired pack does not grant doctor_supported
  update public.service_purchases
    set expires_at = now() - interval '1 day'
    where patient_id = v_patient and service_product_id = v_pack_id;

  update public.chronic_programme_enrolments set status = 'withdrawn', withdrawn_at = now() where id = v_enrolment;
  update public.chronic_programme_enrolments set status = 'enrolled' where id = v_enrolment;
  select track into v_track from public.chronic_programme_enrolments where id = v_enrolment;
  if v_track <> 'self_monitoring' then
    raise exception 'FAIL 4: an expired chronic_doctor_supported_pack still granted doctor_supported (got %)', v_track;
  end if;

  raise notice 'PASS: track defaults to self_monitoring, is immutable to a direct client UPDATE, upgrades to doctor_supported only on an active service purchase, and reverts once that purchase expires';
end $$;

rollback;
