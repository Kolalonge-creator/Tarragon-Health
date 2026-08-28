do $$ begin
  if not exists (select 1 from pg_type where typname = 'family_relationship') then
    create type public.family_relationship as enum (
      'mother', 'father', 'sibling', 'child',
      'maternal_grandmother', 'maternal_grandfather',
      'paternal_grandmother', 'paternal_grandfather',
      'aunt_or_uncle', 'other'
    );
  end if;
end $$;

create table public.family_history (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  condition_name      text not null,
  relationship        public.family_relationship not null,
  relationship_detail text,
  age_of_onset_years  integer check (age_of_onset_years is null or age_of_onset_years between 0 and 120),
  is_deceased         boolean,
  source              text not null default 'patient' check (source in ('patient', 'clinician')),
  recorded_by         uuid references public.profiles (id) on delete set null,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on column public.family_history.relationship_detail is
  'Free-text refinement when relationship = other, or extra colour (e.g. "half-sibling") the enum does not capture.';
comment on column public.family_history.is_deceased is
  'Null = not asked / unknown. Never defaults to false — the spec is explicit that deceased/alive is only recorded "where known".';

create index family_history_patient_idx on public.family_history (patient_id);
create index family_history_org_idx on public.family_history (organisation_id);

create trigger family_history_set_updated_at
  before update on public.family_history
  for each row execute function private.set_updated_at();

alter table public.family_history enable row level security;

create policy family_history_select on public.family_history
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy family_history_insert on public.family_history
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy family_history_update on public.family_history
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy family_history_delete on public.family_history
  for delete to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.family_history to authenticated;
revoke all on public.family_history from anon;

create trigger audit_row_change_trg
  after insert or update or delete on public.family_history
  for each row execute function private.audit_row_change();

create trigger capture_record_correction_trg
  after update or delete on public.family_history
  for each row execute function private.capture_record_correction();

do $$
begin
  if not exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'family_history') then
    raise exception 'FAIL: family_history table was not created';
  end if;
  raise notice 'PASS: family_history — table, RLS, and audit wiring installed';
end $$;
