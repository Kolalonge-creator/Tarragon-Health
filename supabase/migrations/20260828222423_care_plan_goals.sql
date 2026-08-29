do $$ begin
  create type public.care_plan_goal_source as enum
    ('protocol', 'clinician', 'patient');
exception when duplicate_object then null; end $$;

alter table public.care_plan_goals
  add column if not exists metric       text,
  add column if not exists target_value numeric,
  add column if not exists target_unit  text,
  add column if not exists target_date  date,
  add column if not exists source       public.care_plan_goal_source not null default 'clinician',
  add column if not exists proposed_by  uuid references public.profiles (id) on delete set null,
  add column if not exists approved_by  uuid references public.clinical_staff (id) on delete set null,
  add column if not exists approved_at  timestamptz,
  add column if not exists updated_at   timestamptz not null default now();

create index if not exists care_plan_goals_patient_status_idx on public.care_plan_goals (patient_id, status);

drop trigger if exists care_plan_goals_set_updated_at on public.care_plan_goals;
create trigger care_plan_goals_set_updated_at
  before update on public.care_plan_goals
  for each row execute function private.set_updated_at();

create or replace function private.stamp_care_plan_goal_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  if new.status = 'open' and old.status is distinct from 'open' then
    select id into v_staff_id
    from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = new.organisation_id
      and active;
    new.approved_by := v_staff_id;
    new.approved_at := coalesce(new.approved_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists care_plan_goals_stamp_approval on public.care_plan_goals;
create trigger care_plan_goals_stamp_approval
  before update on public.care_plan_goals
  for each row execute function private.stamp_care_plan_goal_approval();

drop policy if exists care_plan_goals_patient_propose_insert on public.care_plan_goals;
create policy care_plan_goals_patient_propose_insert on public.care_plan_goals
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    and status = 'proposed'
    and source = 'patient'
    and approved_by is null
    and approved_at is null
  );

do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'care_plan_goal_status' and e.enumlabel = 'proposed'
  ) then
    raise exception 'care_plan_goal_status.proposed was not added';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'care_plan_goals' and column_name = 'metric'
  ) then
    raise exception 'care_plan_goals.metric was not added';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'care_plan_goals' and column_name = 'source'
  ) then
    raise exception 'care_plan_goals.source was not added';
  end if;
  if not exists (
    select 1 from pg_policy where polname = 'care_plan_goals_patient_propose_insert'
      and polrelid = 'public.care_plan_goals'::regclass
  ) then
    raise exception 'care_plan_goals_patient_propose_insert policy was not created';
  end if;
  raise notice 'PASS: care_plan_goals extended (metric/target/source/proposal columns, proposed status, patient-propose insert policy)';
end $$;
