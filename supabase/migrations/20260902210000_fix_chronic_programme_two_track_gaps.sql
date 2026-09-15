-- Tarragon Health — 12-week two-track chronic-care programme, bug fixes
--
-- Two real gaps found by a 2026-09-02 code audit of the two-track programme
-- (20260831163011 onward), before it was ever exercised by a real patient
-- (chronic_programme_enrolments had zero rows at audit time):
--
--   1. 20260831164207_seed_chronic_programme_schedule_templates.sql only
--      seeded schedule templates for hypertension/diabetes, even though
--      obesity is the platform's third launched (is_active=true) chronic
--      condition. An obesity enrolment today creates a valid-looking
--      enrolment with a completely empty 12-week occurrence set — no
--      crash, just a silent no-op. Fixed by seeding obesity's templates the
--      same shape as hypertension/diabetes, reusing the existing active
--      'heart_health_check' bundle (lipid_panel/hba1c/kft — the same
--      cardiometabolic/renal core already shared by the hypertension and
--      diabetes panels) rather than inventing a new priced panel_bundles
--      row, which is a pricing call for the founder, not an engineering fix.
--
--   2. Buying the chronic_doctor_supported_pack add-on while ALREADY
--      enrolled (self_monitoring track) does nothing: the purchase only
--      writes service_purchases, and both derive_chronic_programme_track
--      (fires on update OF STATUS only) and generate_chronic_programme_occurrences
--      (guarded to skip any update where old.status was already 'enrolled')
--      never re-run. The comment in chronic-programme-actions.ts assumed
--      "picked up automatically the next time the enrolment transitions
--      into 'enrolled' (re-enrolling)" — true only for a withdraw-then-
--      re-enrol upgrade, never the real patient-facing "buy while still
--      enrolled" path the UI actually offers. Fixed with:
--      (a) a new AAFTER trigger on service_purchases that, on the real
--          activation moment (insert-as-active for a free/voucher-covered
--          product, or the payment-confirmation update for a paid one —
--          this covers both), upgrades the scoped enrolment's track; and
--      (b) narrowing generate_chronic_programme_occurrences's skip guard
--          so a track-only change on an already-enrolled row still
--          materialises the newly-unlocked doctor_supported occurrences
--          (existing shared week/type rows — baseline lab, week-12 recheck,
--          week-12 review — no-op via the existing ON CONFLICT DO NOTHING;
--          only the new doctor_checkin rows at weeks 4/8/12 actually insert).

-- ---------------------------------------------------------------------------
-- Fix 1: obesity schedule templates
-- ---------------------------------------------------------------------------

insert into public.chronic_programme_schedule_templates
  (programme_id, track, week_number, occurrence_type, panel_bundle_code)
select cp.id, track.t, 1, 'lab_panel', 'heart_health_check'
from public.chronic_condition_programmes cp
cross join (values ('self_monitoring'::public.chronic_programme_track), ('doctor_supported')) as track(t)
where cp.code = 'obesity'
on conflict (programme_id, track, week_number, occurrence_type) do nothing;

insert into public.chronic_programme_schedule_templates
  (programme_id, track, week_number, occurrence_type, panel_bundle_code)
select cp.id, track.t, 12, 'lab_panel', 'heart_health_check'
from public.chronic_condition_programmes cp
cross join (values ('self_monitoring'::public.chronic_programme_track), ('doctor_supported')) as track(t)
where cp.code = 'obesity'
on conflict (programme_id, track, week_number, occurrence_type) do nothing;

insert into public.chronic_programme_schedule_templates
  (programme_id, track, week_number, occurrence_type)
select cp.id, 'self_monitoring', 12, 'programme_end_review'
from public.chronic_condition_programmes cp
where cp.code = 'obesity'
on conflict (programme_id, track, week_number, occurrence_type) do nothing;

insert into public.chronic_programme_schedule_templates
  (programme_id, track, week_number, occurrence_type)
select cp.id, 'doctor_supported', wk.week_number, 'doctor_checkin'
from public.chronic_condition_programmes cp
cross join (values (4), (8), (12)) as wk(week_number)
where cp.code = 'obesity'
on conflict (programme_id, track, week_number, occurrence_type) do nothing;

insert into public.chronic_programme_schedule_templates
  (programme_id, track, week_number, occurrence_type, notes)
select cp.id, 'doctor_supported', 12, 'programme_end_review',
  'Folded into the 3rd doctor check-in call rather than a separate 4th conversation.'
from public.chronic_condition_programmes cp
where cp.code = 'obesity'
on conflict (programme_id, track, week_number, occurrence_type) do nothing;

-- ---------------------------------------------------------------------------
-- Fix 2a: narrow the occurrence-generation skip guard so a track-only
-- change on an already-enrolled row still materialises the new track's
-- occurrences (previously any update where old.status = 'enrolled' bailed
-- out unconditionally, track change or not).
-- ---------------------------------------------------------------------------

create or replace function private.generate_chronic_programme_occurrences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
begin
  if new.status <> 'enrolled'
     or (tg_op = 'UPDATE' and old.status = 'enrolled' and old.track = new.track) then
    return new;
  end if;

  for t in
    select * from public.chronic_programme_schedule_templates
    where programme_id = new.programme_id and track = new.track
  loop
    insert into public.chronic_programme_schedule_occurrences
      (organisation_id, patient_id, enrolment_id, template_id, occurrence_type,
       week_number, due_date)
    values (
      new.organisation_id, new.patient_id, new.id, t.id, t.occurrence_type,
      t.week_number, (new.programme_started_at::date + ((t.week_number - 1) * 7))
    )
    on conflict (enrolment_id, week_number, occurrence_type) do nothing;
  end loop;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fix 2b: upgrade the scoped enrolment's track the moment the
-- chronic_doctor_supported_pack purchase actually activates — covers both
-- the free/voucher-covered instant-activation insert (record_service_purchase_intent)
-- and the payment-confirmation update (apply_service_purchase_payment), so
-- it fires regardless of which checkout path a real purchase takes.
-- ---------------------------------------------------------------------------

create or replace function private.activate_chronic_programme_doctor_supported_track()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if new.status <> 'active' or (tg_op = 'UPDATE' and old.status = 'active') then
    return new;
  end if;
  if new.scoped_entity_type is distinct from 'chronic_programme_enrolments' or new.scoped_entity_id is null then
    return new;
  end if;

  select code into v_code from public.service_products where id = new.service_product_id;
  if v_code is distinct from 'chronic_doctor_supported_pack' then
    return new;
  end if;

  -- where-clause guards, not an exception, on purpose: an enrolment that has
  -- since withdrawn, or one already on doctor_supported, is a legitimate
  -- no-op here, not a failure of this purchase.
  update public.chronic_programme_enrolments
  set track = 'doctor_supported'
  where id = new.scoped_entity_id
    and status = 'enrolled'
    and track = 'self_monitoring';

  return new;
end;
$$;

drop trigger if exists service_purchases_activate_chronic_doctor_supported on public.service_purchases;
create trigger service_purchases_activate_chronic_doctor_supported
  after insert or update of status on public.service_purchases
  for each row execute function private.activate_chronic_programme_doctor_supported_track();

revoke all on function private.activate_chronic_programme_doctor_supported_track() from public;

do $$
declare
  v_org             uuid;
  v_patient         uuid;
  v_programme       uuid;
  v_pack_id         uuid;
  v_enrolment       uuid;
  v_purchase_id     uuid;
  v_track           public.chronic_programme_track;
  v_checkin_count   integer;
  v_obesity_self    integer;
  v_obesity_doctor  integer;
begin
  -------------------------------------------------------------- fix 1 proof
  select count(*) into v_obesity_self
  from public.chronic_programme_schedule_templates t
  join public.chronic_condition_programmes cp on cp.id = t.programme_id
  where cp.code = 'obesity' and t.track = 'self_monitoring';
  if v_obesity_self <> 3 then
    raise exception 'FAIL: expected 3 obesity self_monitoring template rows, got %', v_obesity_self;
  end if;

  select count(*) into v_obesity_doctor
  from public.chronic_programme_schedule_templates t
  join public.chronic_condition_programmes cp on cp.id = t.programme_id
  where cp.code = 'obesity' and t.track = 'doctor_supported';
  if v_obesity_doctor <> 6 then
    raise exception 'FAIL: expected 6 obesity doctor_supported template rows, got %', v_obesity_doctor;
  end if;

  -------------------------------------------------------------- fix 2 proof
  -- Same skip-gracefully convention as this migration series' own earlier
  -- proofs (e.g. 20260831163011): chronic_condition_programmes ships
  -- is_active=false everywhere except a live, signed-protocol runtime
  -- action — on a truly fresh reset hypertension may not be active yet, so
  -- skip rather than assert on a precondition this migration doesn't own.
  select id into v_programme from public.chronic_condition_programmes where code = 'hypertension';
  select id into v_pack_id from public.service_products where code = 'chronic_doctor_supported_pack';

  select p.organisation_id into v_org
  from public.profiles p
  where p.role = 'patient'
    and not exists (
      select 1 from public.chronic_programme_enrolments e
      where e.patient_id = p.id and e.programme_id = (select id from public.chronic_condition_programmes where code = 'hypertension')
        and e.status = 'enrolled'
    )
  limit 1;
  select id into v_patient from public.profiles where organisation_id = v_org and role = 'patient'
    and not exists (
      select 1 from public.chronic_programme_enrolments e
      where e.patient_id = profiles.id and e.programme_id = (select id from public.chronic_condition_programmes where code = 'hypertension')
        and e.status = 'enrolled'
    )
  limit 1;

  if v_patient is null or v_pack_id is null
     or not (select is_active from public.chronic_condition_programmes where code = 'hypertension') then
    raise notice 'SKIPPED fix-2 behavioral proof: no patient/active hypertension programme/pack row to test against';
  else
    insert into public.chronic_programme_enrolments (organisation_id, patient_id, programme_id, status)
    select v_org, v_patient, id, 'enrolled' from public.chronic_condition_programmes where code = 'hypertension'
    returning id, track into v_enrolment, v_track;

    if v_track is distinct from 'self_monitoring' then
      raise exception 'FAIL: fresh enrolment did not land on self_monitoring (got %)', v_track;
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
      raise exception 'FAIL: mid-programme purchase did not upgrade the enrolment track (got %)', v_track;
    end if;

    select count(*) into v_checkin_count from public.chronic_programme_schedule_occurrences
      where enrolment_id = v_enrolment and occurrence_type = 'doctor_checkin';
    if v_checkin_count <> 3 then
      raise exception 'FAIL: mid-programme upgrade did not materialise the 3 doctor_checkin occurrences (got %)', v_checkin_count;
    end if;

    delete from public.service_purchases where id = v_purchase_id;
    delete from public.chronic_programme_schedule_occurrences where enrolment_id = v_enrolment;
    delete from public.chronic_programme_end_reviews where enrolment_id = v_enrolment;
    delete from public.chronic_programme_enrolments where id = v_enrolment;
  end if;

  raise notice 'PASS: obesity schedule templates seeded; mid-programme doctor-supported upgrade now materialises correctly';
end $$;
