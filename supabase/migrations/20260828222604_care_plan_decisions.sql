create table public.care_plan_decisions (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  care_plan_id        uuid references public.care_plans (id) on delete set null,
  goal_id             uuid references public.care_plan_goals (id) on delete set null,
  recommended_option  text not null,
  alternatives        jsonb not null default '[]'::jsonb,
  patient_preference  text,
  agreed_plan         text not null,
  reason              text,
  decided_by          uuid references public.clinical_staff (id) on delete set null,
  created_at          timestamptz not null default now()
);

create index care_plan_decisions_patient_idx on public.care_plan_decisions (patient_id, created_at desc);
create index care_plan_decisions_org_idx on public.care_plan_decisions (organisation_id);
create index care_plan_decisions_care_plan_idx on public.care_plan_decisions (care_plan_id);

create or replace function private.stamp_care_plan_decision_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select id into new.decided_by
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active;
  return new;
end;
$$;

create trigger care_plan_decisions_stamp_author
  before insert on public.care_plan_decisions
  for each row execute function private.stamp_care_plan_decision_author();

alter table public.care_plan_decisions enable row level security;

create policy care_plan_decisions_select on public.care_plan_decisions
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy care_plan_decisions_insert on public.care_plan_decisions
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

grant select, insert on public.care_plan_decisions to authenticated;
