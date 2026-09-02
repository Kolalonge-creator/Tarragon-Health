-- Tarragon Health — Mental Health & Wellbeing Platform: per-patient next-
-- screening-due tracking (Module 46 §46.4/§46.5), scheduled from the
-- governed cadence in 20260829096000. One row per (patient, instrument),
-- rolled forward automatically every time a screen is submitted — same
-- upsert-on-conflict shape as wellbeing_checkin_preferences, not the
-- pending/completed workflow medication_reviews uses, since a screen is a
-- one-shot submission, not a task a clinician marks done later.

create table public.mental_health_screening_schedules (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  instrument       text not null check (instrument in ('phq9', 'gad7', 'auditc')),
  due_date         date not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index mental_health_screening_schedules_patient_instrument_idx
  on public.mental_health_screening_schedules (patient_id, instrument);
create index mental_health_screening_schedules_org_idx
  on public.mental_health_screening_schedules (organisation_id);
create index mental_health_screening_schedules_due_date_idx
  on public.mental_health_screening_schedules (due_date);

alter table public.mental_health_screening_schedules enable row level security;

-- Read: the patient (their own) or org staff. No insert/update grant — rows
-- are computed server-side by the trigger below, same convention as
-- mental_health_screens itself (a client can never post a spoofed due date).
create policy mental_health_screening_schedules_select on public.mental_health_screening_schedules
  for select using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

create or replace function private.schedule_next_mental_health_screen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_concern text;
  v_months  integer;
begin
  -- EPDS is context-triggered (perinatal self-identification each time),
  -- not on a periodic cadence — nothing to schedule.
  if new.instrument not in ('phq9', 'gad7', 'auditc') then
    return new;
  end if;

  v_concern := private.classify_mental_health_screen_concern(new.instrument, new.severity_band, new.hazardous);
  v_months := private.mental_health_screening_cadence_months(new.instrument, v_concern);

  insert into public.mental_health_screening_schedules
    (organisation_id, patient_id, instrument, due_date)
  values (
    new.organisation_id, new.patient_id, new.instrument,
    current_date + (v_months || ' months')::interval
  )
  on conflict (patient_id, instrument) do update
    set due_date = excluded.due_date, updated_at = now();

  return new;
end;
$$;

comment on function private.schedule_next_mental_health_screen() is
  'AFTER INSERT on mental_health_screens. Rolls the patient''s next-due date forward for phq9/gad7/auditc using the governed cadence (20260829096000) and the same concern classification the risk-stratification trigger (20260829091000) uses — a moderate/high result schedules a sooner re-screen. Runs regardless of crisis_flagged: even a crisis submission still needs a future re-screen date once the immediate concern is addressed.';

create trigger mental_health_screens_schedule_next
  after insert on public.mental_health_screens
  for each row execute function private.schedule_next_mental_health_screen();

revoke all on function private.schedule_next_mental_health_screen() from public;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'mental_health_screens_schedule_next'
      and tgrelid = 'public.mental_health_screens'::regclass and not tgisinternal
  ) then
    raise exception 'mental_health_screens_schedule_next trigger was not created';
  end if;

  raise notice 'PASS: mental_health_screening_schedules created, scheduling trigger installed';
end $$;
