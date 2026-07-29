-- ===========================================================================
-- Diabetes Clinical Pathway — Sprint C (part 2): retinal + renal surveillance
-- ---------------------------------------------------------------------------
-- §18.2 (eyes) + §18.3 (kidneys) + §8.3: dilated retinal screening and urine
-- ACR/eGFR at diagnosis and at least annually. Foot surveillance already has
-- its own richer table (diabetic_foot_assessments); this tracks the other two
-- complication checks with the same clinician-recorded, patient-visible,
-- next-due model. Abnormal RESULTS still flow the existing abnormal-result
-- handler (eGFR<30, rising ACR, retinopathy) — this table is the CADENCE
-- tracker (was it done, when's the next one), not a second results store.
-- ===========================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'complication_check_type') then
    create type public.complication_check_type as enum ('retinal', 'renal');
  end if;
end $$;

create table if not exists public.diabetes_complication_checks (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  check_type      public.complication_check_type not null,
  -- server-derived from the acting clinician's clinical_staff row.
  recorded_by     uuid references public.clinical_staff (id) on delete set null,
  outcome         text,
  abnormal        boolean not null default false,
  done_at         date not null default (now() at time zone 'Africa/Lagos')::date,
  next_due_at     date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists diabetes_complication_checks_patient_idx
  on public.diabetes_complication_checks (patient_id, check_type, done_at desc);
create index if not exists diabetes_complication_checks_org_idx
  on public.diabetes_complication_checks (organisation_id);
create index if not exists diabetes_complication_checks_due_idx
  on public.diabetes_complication_checks (next_due_at);

drop trigger if exists diabetes_complication_checks_set_updated_at on public.diabetes_complication_checks;
create trigger diabetes_complication_checks_set_updated_at
  before update on public.diabetes_complication_checks
  for each row execute function private.set_updated_at();

alter table public.diabetes_complication_checks enable row level security;

drop policy if exists diabetes_complication_checks_select on public.diabetes_complication_checks;
create policy diabetes_complication_checks_select on public.diabetes_complication_checks
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists diabetes_complication_checks_insert on public.diabetes_complication_checks;
create policy diabetes_complication_checks_insert on public.diabetes_complication_checks
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));
drop policy if exists diabetes_complication_checks_update on public.diabetes_complication_checks;
create policy diabetes_complication_checks_update on public.diabetes_complication_checks
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.diabetes_complication_checks to authenticated;
