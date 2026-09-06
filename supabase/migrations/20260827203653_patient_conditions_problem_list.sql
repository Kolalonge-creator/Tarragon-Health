do $$ begin
  if not exists (select 1 from pg_type where typname = 'clinical_severity') then
    create type public.clinical_severity as enum ('mild', 'moderate', 'severe');
  end if;
end $$;

comment on type public.clinical_severity is
  'Same three-tier scale as allergy_severity, named generically because it now applies to more than allergies (patient_conditions.severity). Intentionally not the same enum type as allergy_severity — that name is allergy-specific and reusing it here would read wrong on this table.';

do $$ begin
  if not exists (select 1 from pg_type where typname = 'condition_clinical_status') then
    create type public.condition_clinical_status as enum (
      'suspected', 'under_investigation', 'active', 'controlled', 'uncontrolled',
      'resolved', 'historical'
    );
  end if;
end $$;

create table public.patient_conditions (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  patient_id              uuid not null references public.profiles (id) on delete cascade,
  condition_name          text not null,
  icd10_code              text,
  status                  public.condition_clinical_status not null default 'suspected',
  severity                public.clinical_severity,
  date_identified         date,
  diagnosing_clinician_id uuid references public.profiles (id) on delete set null,
  supporting_evidence     text,
  current_treatment       text,
  last_reviewed_at        timestamptz,
  next_review_due_at      timestamptz,
  recorded_by             uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index patient_conditions_patient_idx on public.patient_conditions (patient_id, status);
create index patient_conditions_org_idx on public.patient_conditions (organisation_id);
create index patient_conditions_next_review_idx on public.patient_conditions (next_review_due_at)
  where next_review_due_at is not null;

create trigger patient_conditions_set_updated_at
  before update on public.patient_conditions
  for each row execute function private.set_updated_at();

alter table public.patient_conditions enable row level security;

create policy patient_conditions_select on public.patient_conditions
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy patient_conditions_insert on public.patient_conditions
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));
create policy patient_conditions_update on public.patient_conditions
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));
create policy patient_conditions_delete on public.patient_conditions
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.patient_conditions to authenticated;
revoke all on public.patient_conditions from anon;

alter table public.care_plans
  add column if not exists patient_condition_id uuid references public.patient_conditions (id) on delete set null;

create index if not exists care_plans_patient_condition_idx on public.care_plans (patient_condition_id)
  where patient_condition_id is not null;

comment on column public.care_plans.patient_condition_id is
  'Links this care programme to the problem-list entry it manages, once one exists. Nullable: a care plan predating this column, or one whose condition was never entered on the problem list, is still valid with this null. Never backfilled — see docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md §3 Q1.';

create or replace function private.timeline_from_patient_condition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  v_actor := private.timeline_staff_from_profile(
    coalesce(new.diagnosing_clinician_id, new.recorded_by), new.organisation_id
  );

  perform private.record_timeline_event(
    new.organisation_id, new.patient_id,
    case when tg_op = 'INSERT' then 'condition_recorded' else 'condition_status_changed' end,
    'patient_conditions', new.id,
    case when tg_op = 'INSERT' then 'Condition added to your record' else 'Condition status updated' end,
    new.condition_name || ' · ' || replace(new.status::text, '_', ' '),
    coalesce(new.updated_at, new.created_at, now()),
    v_actor
  );
  return new;
end;
$$;

drop trigger if exists patient_conditions_timeline_insert on public.patient_conditions;
create trigger patient_conditions_timeline_insert
  after insert on public.patient_conditions
  for each row execute function private.timeline_from_patient_condition();

drop trigger if exists patient_conditions_timeline_status on public.patient_conditions;
create trigger patient_conditions_timeline_status
  after update of status on public.patient_conditions
  for each row execute function private.timeline_from_patient_condition();

create trigger audit_row_change_trg
  after insert or update or delete on public.patient_conditions
  for each row execute function private.audit_row_change();

create trigger capture_record_correction_trg
  after update or delete on public.patient_conditions
  for each row execute function private.capture_record_correction();

do $$
begin
  if not exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'patient_conditions') then
    raise exception 'FAIL: patient_conditions table was not created';
  end if;

  if not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'care_plans' and column_name = 'patient_condition_id') then
    raise exception 'FAIL: care_plans.patient_condition_id was not added';
  end if;

  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname = 'patient_conditions' and tg.tgname = 'audit_row_change_trg' and not tg.tgisinternal
  ) then
    raise exception 'FAIL: patient_conditions is missing audit_row_change_trg';
  end if;

  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname = 'patient_conditions' and tg.tgname = 'capture_record_correction_trg' and not tg.tgisinternal
  ) then
    raise exception 'FAIL: patient_conditions is missing capture_record_correction_trg';
  end if;

  raise notice 'PASS: patient_conditions_problem_list — table, RLS, timeline, and audit wiring installed';
end $$;
