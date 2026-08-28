create table public.social_history (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  patient_id              uuid not null references public.profiles (id) on delete cascade,
  occupation              text,
  occupational_exposure   text,
  living_situation        text,
  healthcare_access       text,
  socioeconomic_barriers  text[] not null default '{}',
  source                  text not null default 'patient' check (source in ('patient', 'clinician')),
  recorded_by             uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint social_history_one_row_per_patient unique (patient_id)
);

comment on column public.social_history.socioeconomic_barriers is
  'Free-form tags (e.g. "transport cost", "no stable address"), same array-of-text shape as screening_results.abnormal_flags — not an enum, the real-world set is too open-ended to close off.';

create index social_history_org_idx on public.social_history (organisation_id);

create trigger social_history_set_updated_at
  before update on public.social_history
  for each row execute function private.set_updated_at();

alter table public.social_history enable row level security;

create policy social_history_select on public.social_history
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy social_history_insert on public.social_history
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy social_history_update on public.social_history
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy social_history_delete on public.social_history
  for delete to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.social_history to authenticated;
revoke all on public.social_history from anon;

create trigger audit_row_change_trg
  after insert or update or delete on public.social_history
  for each row execute function private.audit_row_change();

create trigger capture_record_correction_trg
  after update or delete on public.social_history
  for each row execute function private.capture_record_correction();

do $$
begin
  if not exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'social_history') then
    raise exception 'FAIL: social_history table was not created';
  end if;
  raise notice 'PASS: social_history — table, RLS, and audit wiring installed';
end $$;
