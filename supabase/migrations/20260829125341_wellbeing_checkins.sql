-- Tarragon Health — Mental Health & Wellbeing Platform (Module 46 §46.2,
-- §46.13): a lightweight, patient-controlled mood/stress/sleep/activity
-- self-tracking feature. Deliberately a separate table from vitals_readings
-- — mood/stress/sleep-quality/activity-level have no vitals_readings column
-- equivalent (unlike heart rate/weight/SpO2, which correctly stay out of
-- this and belong in vitals_readings with source='wearable'/'device').
--
-- Not a clinical instrument (that's mental_health_screens — PHQ-9/GAD-7/
-- AUDIT-C/EPDS) and never fed into risk/escalation scoring: this is
-- engagement telemetry the patient owns, at whatever frequency they choose
-- (§46.13 "the patient controls how frequently they track") — no forced
-- cadence, no clinician alert, no crisis-detection logic. Same append-only,
-- patient/acting-supporter-writable shape as vitals_readings/symptoms,
-- reusing the existing private.can_act_for / private.stamp_acting_supporter
-- acting-for-a-dependent primitives (20260801110000) rather than
-- reinventing them.

create table public.wellbeing_checkins (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  mood_score            smallint not null check (mood_score between 1 and 5),
  stress_score          smallint not null check (stress_score between 1 and 5),
  sleep_quality         smallint not null check (sleep_quality between 1 and 5),
  activity_level        smallint not null check (activity_level between 1 and 5),
  note                  text,
  logged_by_profile_id  uuid references public.profiles (id),
  checked_in_at         timestamptz not null default now(),
  created_at            timestamptz not null default now()
);

comment on column public.wellbeing_checkins.logged_by_profile_id is
  'Who physically entered this, when that is not the patient. NULL = the patient themselves. Server-derived from auth.uid() by private.stamp_acting_supporter and NOT client-supplied — same convention as vitals_readings/symptoms.';

create index wellbeing_checkins_patient_idx
  on public.wellbeing_checkins (patient_id, checked_in_at desc);

alter table public.wellbeing_checkins enable row level security;

create policy wellbeing_checkins_select on public.wellbeing_checkins
  for select using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

create policy wellbeing_checkins_insert on public.wellbeing_checkins
  for insert to authenticated
  with check (patient_id = (select auth.uid()));

create policy wellbeing_checkins_insert_acting_supporter on public.wellbeing_checkins
  for insert to authenticated
  with check (private.can_act_for(patient_id));

create trigger stamp_acting_supporter
  before insert on public.wellbeing_checkins
  for each row execute function private.stamp_acting_supporter();

-- One reminder-frequency preference per patient — "the patient controls how
-- frequently they track" made concrete and editable, not a fixed cadence.
create table public.wellbeing_checkin_preferences (
  patient_id            uuid primary key references public.profiles (id) on delete cascade,
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  reminder_frequency_days smallint not null default 7 check (reminder_frequency_days between 1 and 90),
  updated_at            timestamptz not null default now()
);

alter table public.wellbeing_checkin_preferences enable row level security;

create policy wellbeing_checkin_preferences_select on public.wellbeing_checkin_preferences
  for select using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

create policy wellbeing_checkin_preferences_upsert on public.wellbeing_checkin_preferences
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.can_act_for(patient_id));

create policy wellbeing_checkin_preferences_update on public.wellbeing_checkin_preferences
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.can_act_for(patient_id))
  with check (patient_id = (select auth.uid()) or private.can_act_for(patient_id));

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'stamp_acting_supporter'
      and tgrelid = 'public.wellbeing_checkins'::regclass and not tgisinternal
  ) then
    raise exception 'stamp_acting_supporter trigger was not created on wellbeing_checkins';
  end if;

  raise notice 'PASS: wellbeing_checkins + wellbeing_checkin_preferences created with RLS';
end $$;
