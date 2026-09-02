-- Tarragon Health — 12-week two-track chronic-care programme, Phase 2 (schedule)
--
-- A weekly schedule TEMPLATE (global catalogue, one row per condition x
-- track x week x occurrence type) and per-patient OCCURRENCES generated
-- from it at enrolment time. Deliberately does not model vitals-reading
-- cadence — vitals_reminder_rules/private.queue_vitals_reminders() already
-- own that rolling cadence; a second weekly-occurrence type for the same
-- thing would create two sources of truth for "how often should this
-- patient log a reading."

create type public.chronic_schedule_occurrence_type as enum (
  'lab_panel', 'doctor_checkin', 'programme_end_review'
);
create type public.chronic_schedule_occurrence_status as enum (
  'pending', 'completed', 'missed', 'skipped'
);

create table public.chronic_programme_schedule_templates (
  id                uuid primary key default gen_random_uuid(),
  programme_id      uuid not null references public.chronic_condition_programmes (id) on delete cascade,
  track             public.chronic_programme_track not null,
  week_number       smallint not null check (week_number between 1 and 12),
  occurrence_type   public.chronic_schedule_occurrence_type not null,
  panel_bundle_code text references public.panel_bundles (code) on delete restrict,
  is_required       boolean not null default true,
  notes             text,
  created_at        timestamptz not null default now(),
  unique (programme_id, track, week_number, occurrence_type),
  constraint chronic_schedule_templates_bundle_only_for_lab_panel check (
    (occurrence_type = 'lab_panel') = (panel_bundle_code is not null)
  )
);

create table public.chronic_programme_schedule_occurrences (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  enrolment_id      uuid not null references public.chronic_programme_enrolments (id) on delete cascade,
  template_id       uuid references public.chronic_programme_schedule_templates (id) on delete set null,
  occurrence_type   public.chronic_schedule_occurrence_type not null,
  week_number       smallint not null,
  due_date          date not null,
  status            public.chronic_schedule_occurrence_status not null default 'pending',
  lab_order_id      uuid references public.lab_orders (id) on delete set null,
  appointment_id    uuid references public.appointments (id) on delete set null,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (enrolment_id, week_number, occurrence_type),
  constraint chronic_schedule_occurrences_result_shape check (
    (occurrence_type = 'lab_panel' and appointment_id is null)
    or (occurrence_type = 'doctor_checkin' and lab_order_id is null)
    or (occurrence_type = 'programme_end_review' and lab_order_id is null and appointment_id is null)
  )
);

create index chronic_schedule_occurrences_due_idx
  on public.chronic_programme_schedule_occurrences (status, due_date) where status = 'pending';
create index chronic_schedule_occurrences_patient_idx
  on public.chronic_programme_schedule_occurrences (patient_id);
create index chronic_schedule_occurrences_org_idx
  on public.chronic_programme_schedule_occurrences (organisation_id);

create trigger chronic_programme_schedule_occurrences_set_updated_at
  before update on public.chronic_programme_schedule_occurrences
  for each row execute function private.set_updated_at();

alter table public.chronic_programme_schedule_templates  enable row level security;
alter table public.chronic_programme_schedule_occurrences enable row level security;

-- Templates: global catalogue, same authenticated-read/admin-write shape as
-- chronic_condition_programmes/panel_bundles.
create policy chronic_programme_schedule_templates_select on public.chronic_programme_schedule_templates
  for select to authenticated using (true);
create policy chronic_programme_schedule_templates_insert on public.chronic_programme_schedule_templates
  for insert to authenticated with check (private.is_admin());
create policy chronic_programme_schedule_templates_update on public.chronic_programme_schedule_templates
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy chronic_programme_schedule_templates_delete on public.chronic_programme_schedule_templates
  for delete to authenticated using (private.is_admin());

-- Occurrences: patient reads own; org staff (including Care Coordinator,
-- whose logistics remit this is) read/write within org. No client insert —
-- rows are only ever created by the generation trigger below.
create policy chronic_programme_schedule_occurrences_select on public.chronic_programme_schedule_occurrences
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy chronic_programme_schedule_occurrences_update on public.chronic_programme_schedule_occurrences
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.chronic_programme_schedule_templates to authenticated;
grant select, update on public.chronic_programme_schedule_occurrences to authenticated;

-- Materialises ALL 12 weeks' occurrences in one pass on the transition INTO
-- 'enrolled' — the programme is fixed-length and fully known up front
-- (unlike medication_reviews, which rolls one row at a time forever via
-- private.ensure_medication_review()), so there is no reason to generate
-- incrementally. Fires AFTER derive_chronic_programme_track (a BEFORE
-- trigger, alphabetically earlier is irrelevant here — trigger order is by
-- name, and 'derive_chronic_programme_track' < 'generate_chronic_programme_occurrences'
-- lexically, but the real ordering guarantee is BEFORE-vs-AFTER, not name).
create or replace function private.generate_chronic_programme_occurrences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
begin
  if new.status <> 'enrolled' or (tg_op = 'UPDATE' and old.status = 'enrolled') then
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

drop trigger if exists chronic_programme_enrolments_generate_occurrences on public.chronic_programme_enrolments;
create trigger chronic_programme_enrolments_generate_occurrences
  after insert or update of status, track on public.chronic_programme_enrolments
  for each row execute function private.generate_chronic_programme_occurrences();

do $$
begin
  if has_table_privilege('anon', 'public.chronic_programme_schedule_occurrences', 'INSERT') then
    raise exception 'FAIL: anon must not be able to write chronic_programme_schedule_occurrences';
  end if;
  raise notice 'PASS: chronic programme schedule tables + generation trigger in place';
end $$;
