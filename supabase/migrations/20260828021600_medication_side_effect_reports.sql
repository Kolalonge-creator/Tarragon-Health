-- Tarragon Health — medication side-effect reporting (13.8)
--
-- 13.8: "Patient can report 'I think this medication is causing...'.
-- System should collect medication/symptom/onset/severity/duration.
-- Potentially significant reports should generate an appropriate clinical
-- task." The closest existing thing (medication_adherence_checkins'
-- checkin_type='side_effects') only ever captures one freeform `response`
-- column at a fixed Week-2 check-in, and nothing downstream reads it — this
-- is a genuinely separate, patient-initiated ("I think X is causing Y",
-- any time, not just at the scheduled check-in), structured report, feeding
-- the brand-new unified clinician_alerts taxonomy at exactly the seam its own
-- authors flagged as open: `medication_safety`'s own alert_rules
-- evidence_basis (20260828013011) reads "Reserved for future automated
-- interaction detection; currently clinician-raised only" — a structured,
-- moderate/severe side-effect report IS the kind of real event source that
-- comment was written in anticipation of.
--
-- Append-only from the patient's side on purpose: no UPDATE policy is
-- granted to the patient at all. A safety report a patient submitted is a
-- fact about what they told their care team on that date — if a detail was
-- wrong or has changed, the honest record is a further report or a
-- clinician's own reviewed_by/review_notes annotation, not a silent
-- self-edit of the original. Only org staff (reviewing) may update a row.
--
-- Severity drives escalation: moderate/severe raises a real clinician_alerts
-- row (category='clinical', type_code='medication_safety' — matching that
-- type_code's own governance record rather than inventing a new one); mild
-- reports stay visible on the clinician review worklist without paging
-- anyone, matching this platform's "advisory, not everything is an
-- emergency" posture elsewhere (13.9's own "support decision-making, not
-- blindly block/alarm on everything").

do $$ begin
  if not exists (select 1 from pg_type where typname = 'medication_side_effect_severity') then
    create type public.medication_side_effect_severity as enum ('mild', 'moderate', 'severe');
  end if;
  if not exists (select 1 from pg_type where typname = 'medication_side_effect_status') then
    create type public.medication_side_effect_status as enum ('new', 'reviewed', 'dismissed');
  end if;
end $$;

create table if not exists public.medication_side_effect_reports (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  medication_id     uuid not null references public.medications (id) on delete cascade,
  symptom           text not null check (char_length(symptom) between 1 and 300),
  onset_date        date,
  severity          public.medication_side_effect_severity not null,
  duration_text     text check (char_length(duration_text) <= 200),
  description       text check (char_length(description) <= 1000),
  reported_at       timestamptz not null default now(),
  reported_by       uuid references public.profiles (id) on delete set null,
  status            public.medication_side_effect_status not null default 'new',
  reviewed_by       uuid references public.clinical_staff (id) on delete set null,
  reviewed_at       timestamptz,
  review_notes      text check (char_length(review_notes) <= 1000),
  clinician_alert_id uuid references public.clinician_alerts (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists med_side_effect_reports_patient_idx
  on public.medication_side_effect_reports (patient_id, reported_at desc);
create index if not exists med_side_effect_reports_medication_idx
  on public.medication_side_effect_reports (medication_id);
create index if not exists med_side_effect_reports_org_status_idx
  on public.medication_side_effect_reports (organisation_id, status);

drop trigger if exists med_side_effect_reports_set_updated_at on public.medication_side_effect_reports;
create trigger med_side_effect_reports_set_updated_at
  before update on public.medication_side_effect_reports
  for each row execute function private.set_updated_at();

alter table public.medication_side_effect_reports enable row level security;

-- Patient may read + submit their own reports; org staff read + review.
drop policy if exists med_side_effect_reports_select on public.medication_side_effect_reports;
create policy med_side_effect_reports_select on public.medication_side_effect_reports
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists med_side_effect_reports_insert on public.medication_side_effect_reports;
create policy med_side_effect_reports_insert on public.medication_side_effect_reports
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
-- No patient update policy at all — see header on why this is append-only
-- from the patient's side. Only staff may transition status/reviewed_*.
drop policy if exists med_side_effect_reports_update on public.medication_side_effect_reports;
create policy med_side_effect_reports_update on public.medication_side_effect_reports
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.medication_side_effect_reports to authenticated;

-- --- reported_by (server-derived, never client-supplied) ----------------------
create or replace function private.stamp_side_effect_report_reporter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.reported_by := (select auth.uid());
  return new;
end;
$$;

drop trigger if exists med_side_effect_reports_stamp_reporter on public.medication_side_effect_reports;
create trigger med_side_effect_reports_stamp_reporter
  before insert on public.medication_side_effect_reports
  for each row execute function private.stamp_side_effect_report_reporter();

-- --- reviewed_by/reviewed_at (server-derived, same pattern as medication_reviews) ---
create or replace function private.stamp_side_effect_report_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  if new.status <> 'new' and old.status = 'new' then
    select id into v_staff_id
    from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = new.organisation_id
      and active;
    new.reviewed_by := v_staff_id;
    new.reviewed_at := coalesce(new.reviewed_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists med_side_effect_reports_stamp_review on public.medication_side_effect_reports;
create trigger med_side_effect_reports_stamp_review
  before update on public.medication_side_effect_reports
  for each row execute function private.stamp_side_effect_report_review();

-- --- moderate/severe reports raise a real clinical task -----------------------
create or replace function private.raise_side_effect_report_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_drug     text;
  v_level    public.alert_level;
  v_alert_id uuid;
begin
  if new.severity not in ('moderate', 'severe') then
    return new;
  end if;

  select drug_name into v_drug from public.medications where id = new.medication_id;
  v_level := case new.severity when 'severe' then 'urgent_escalation' else 'clinician_review' end;

  v_alert_id := private.raise_clinician_alert(
    new.organisation_id, new.patient_id, v_level,
    'Patient-reported medication side effect',
    format(
      'Reported %s side effect from %s: %s.%s%s',
      new.severity,
      coalesce(v_drug, 'a medication'),
      new.symptom,
      case when new.duration_text is not null then ' Duration: ' || new.duration_text || '.' else '' end,
      case when new.description is not null then ' ' || new.description else '' end
    ),
    'clinical', 'medication_safety'
  );

  update public.medication_side_effect_reports
    set clinician_alert_id = v_alert_id
    where id = new.id;

  return new;
end;
$$;

drop trigger if exists med_side_effect_reports_raise_alert on public.medication_side_effect_reports;
create trigger med_side_effect_reports_raise_alert
  after insert on public.medication_side_effect_reports
  for each row execute function private.raise_side_effect_report_alert();

-- --- platform-wide audit/correction coverage, same as every other clinical
-- table (patient_allergies' own retrofit is the direct precedent — this new
-- table joins the 21-table clinical core from day one instead of needing a
-- later catch-up migration). ---
create trigger audit_row_change_trg
  after insert or update or delete on public.medication_side_effect_reports
  for each row execute function private.audit_row_change();

create trigger capture_record_correction_trg
  after update or delete on public.medication_side_effect_reports
  for each row execute function private.capture_record_correction();

do $$
begin
  if not exists (select 1 from pg_type where typname = 'medication_side_effect_severity') then
    raise exception 'medication_side_effect_severity enum was not created';
  end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'medication_side_effect_reports'
  ) then
    raise exception 'medication_side_effect_reports table was not created';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'medication_side_effect_reports'
      and cmd = 'UPDATE' and qual::text like '%patient_id%'
  ) then
    raise exception 'FAIL: a patient must not be able to update their own side-effect report';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'med_side_effect_reports_raise_alert'
      and tgrelid = 'public.medication_side_effect_reports'::regclass and not tgisinternal
  ) then
    raise exception 'med_side_effect_reports_raise_alert trigger was not created';
  end if;
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname = 'medication_side_effect_reports' and tg.tgname = 'audit_row_change_trg' and not tg.tgisinternal
  ) then
    raise exception 'FAIL: medication_side_effect_reports is missing audit_row_change_trg';
  end if;
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname = 'medication_side_effect_reports' and tg.tgname = 'capture_record_correction_trg' and not tg.tgisinternal
  ) then
    raise exception 'FAIL: medication_side_effect_reports is missing capture_record_correction_trg';
  end if;
  if has_function_privilege('anon', 'private.raise_side_effect_report_alert()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.raise_side_effect_report_alert';
  end if;
  raise notice 'PASS: medication_side_effect_reports table, RLS, attribution, alert generator, and audit coverage installed';
end $$;
