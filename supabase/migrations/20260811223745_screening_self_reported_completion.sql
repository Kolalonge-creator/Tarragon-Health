-- Tarragon Health — Patient self-reported screening completion
--
-- Today, when a patient's preventive-screening calendar (screening_schedules)
-- shows a test as due, the only patient-facing action is "Get this test"
-- (create a self-arranged lab order) — there is no way for a patient to say
-- "I already had this done, here's the date", and nothing rolls the calendar
-- forward off that date. The existing roll-forward path
-- (private.refresh_screening_schedule_on_result, 20260802232317) only fires
-- off a CLINICIAN-authored screening_results row with an interpreted value —
-- deliberately so, per lab_result_documents.sql's "uploading a document is
-- NEVER auto-parsed into a screening_result" boundary. That clinical-values
-- boundary is correct and untouched by this migration.
--
-- This adds a narrower, patient-writable fact distinct from screening_results:
-- "I had this screening done on this date" — no clinical value, no ML
-- interpretation, just a logistics self-report, same shape and same
-- self-report trust level as vaccination_records (patient-insert-own,
-- 20260716190000). A new screening_completions row:
--   1. Closes the screening_schedules row it satisfies.
--   2. Schedules the NEXT cycle from the patient-reported performed_date —
--      not from today (the confirmation date) and not a fixed calendar
--      cadence — mirroring computeScreeningRecommendations'
--      addMonths(lastCompleted, frequencyMonths) contract, just anchored on
--      the self-reported date instead of a clinician result's created_at.
-- lab_result_documents gains an optional FK back to the completion it
-- belongs to, so the "now upload your result" step that follows confirmation
-- can be linked for clinician review, without touching the existing
-- upload/review flow for anyone who uploads without going through this path.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table public.screening_completions (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  -- The specific calendar row this confirms, when the patient acted from
  -- their calendar (the only current UI path). Nullable so a future
  -- standalone "log a screening" entry point isn't blocked on one existing.
  schedule_id       uuid references public.screening_schedules (id) on delete set null,
  screen_type_id    uuid not null references public.screen_types (id) on delete restrict,
  -- The actual date the test was performed, as reported by the patient —
  -- this, not created_at, is what the next cycle is scheduled from.
  performed_date    date not null,
  note              text,
  created_at        timestamptz not null default now(),
  constraint screening_completions_performed_date_not_future check (performed_date <= current_date)
);

create index screening_completions_patient_idx on public.screening_completions (patient_id, performed_date desc);
create index screening_completions_org_idx on public.screening_completions (organisation_id);
create index screening_completions_schedule_idx on public.screening_completions (schedule_id);
create index screening_completions_screen_type_idx on public.screening_completions (screen_type_id);

-- ---------------------------------------------------------------------------
-- 2. RLS — patient inserts/reads own; org staff read (same read shape as
-- lab_result_documents). No org-staff insert here: this is deliberately the
-- patient's own self-report, not a staff-logged action — unlike
-- lab_result_documents, which staff also upload into on a patient's behalf.
-- ---------------------------------------------------------------------------
alter table public.screening_completions enable row level security;

create policy screening_completions_select on public.screening_completions
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy screening_completions_insert on public.screening_completions
  for insert to authenticated
  with check (patient_id = (select auth.uid()));

-- RLS restricts ROWS; it does not grant table access at all. A table added by
-- a plain migration needs this explicit grant even with the default-privileges
-- root fix (20260731232749) in place — stated explicitly rather than assumed,
-- matching every table added since that fix (see e.g. case_review_actions,
-- care_outreach_contacts).
grant select, insert on public.screening_completions to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Roll the calendar forward off the reported date
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so a patient-initiated insert can update
-- screening_schedules (whose due_date/status are the recommendation engine's
-- computation, not a value a patient session writes directly — same
-- boundary generateVaccinationScheduleBestEffort and
-- refresh_screening_schedule_on_result already draw) and insert the next
-- cycle's row.
create or replace function private.refresh_screening_schedule_on_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_frequency_months int;
begin
  select frequency_months
    into v_frequency_months
  from public.screen_types
  where id = new.screen_type_id;

  -- Close whichever active schedule row this confirms. Prefer the specific
  -- row the patient acted from (new.schedule_id); fall back to matching by
  -- patient + screen type for a future entry point with no schedule link,
  -- same fallback shape as refresh_screening_schedule_on_result's
  -- self-bookable-order branch.
  update public.screening_schedules
  set status = 'completed'
  where status in ('pending', 'booked', 'overdue')
    and (
      (new.schedule_id is not null and id = new.schedule_id)
      or (
        new.schedule_id is null
        and patient_id = new.patient_id
        and screen_type_id = new.screen_type_id
      )
    );

  -- Recurring screenings roll to the next cycle from the ACTUAL test date the
  -- patient reported — not today, and not a re-run of a fixed calendar
  -- cadence. One-off screenings (frequency_months is null) get no follow-up
  -- row, same as the sibling clinician-result trigger.
  if v_frequency_months is not null then
    insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, due_date, status)
    values (
      new.organisation_id,
      new.patient_id,
      new.screen_type_id,
      (new.performed_date + (v_frequency_months || ' months')::interval)::date,
      'pending'
    );
  end if;

  return new;
exception
  when others then
    -- Confirming a completed screening must never be blocked by the calendar
    -- refresh — same best-effort discipline as
    -- refresh_screening_schedule_on_result and
    -- generateVaccinationScheduleBestEffort.
    return new;
end;
$$;

create trigger screening_completions_refresh_schedule
  after insert on public.screening_completions
  for each row execute function private.refresh_screening_schedule_on_completion();

-- ---------------------------------------------------------------------------
-- 4. lab_result_documents: optional link back to the completion it belongs to
-- ---------------------------------------------------------------------------
alter table public.lab_result_documents
  add column screening_completion_id uuid references public.screening_completions (id) on delete set null;

create index lab_result_documents_screening_completion_idx
  on public.lab_result_documents (screening_completion_id)
  where screening_completion_id is not null;

-- Re-state the patient-insert branch with a same-patient check on the new FK,
-- so a patient can't tag their own upload with someone else's completion id.
-- Byte-identical otherwise to the 20260720120100 definition.
drop policy if exists lab_result_documents_insert on public.lab_result_documents;
create policy lab_result_documents_insert on public.lab_result_documents
  for insert to authenticated
  with check (
    (
      patient_id = (select auth.uid())
      and source = 'patient'
      and (
        screening_completion_id is null
        or exists (
          select 1 from public.screening_completions sc
          where sc.id = screening_completion_id
            and sc.patient_id = (select auth.uid())
        )
      )
    )
    or private.is_org_staff(organisation_id)
  );

-- ---------------------------------------------------------------------------
-- 5. Assertions — prove this is provable, not hopeful.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'screening_completions'
  ) then
    raise exception 'screening_completions table was not created';
  end if;

  if not has_table_privilege('authenticated', 'public.screening_completions', 'INSERT') then
    raise exception 'screening_completions: authenticated insert grant did not take';
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'screening_completions_refresh_schedule'
  ) then
    raise exception 'screening_completions_refresh_schedule trigger was not created';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lab_result_documents'
      and column_name = 'screening_completion_id'
  ) then
    raise exception 'lab_result_documents.screening_completion_id was not added';
  end if;
end $$;
