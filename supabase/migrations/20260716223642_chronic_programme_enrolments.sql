-- Tarragon Health — Chronic Disease Programme catalogue, step 4/4
--
-- chronic_programme_enrolments: the pathway's "programme enrolment" step for
-- chronic disease. Unlike preventive enrolment (patient self-enrol), chronic
-- enrolment follows a clinical diagnosis, so it is STAFF-initiated: a clinician
-- enrols a diagnosed patient, optionally linking the care_plan that carries the
-- clinical detail (targets, monitoring). The patient-facing card surfaces
-- recommendations ("discuss with your care team") but cannot self-enrol.
--
-- The phased-rollout guarantee is enforced here at the database, not just the
-- UI: a patient can only be enrolled into a condition whose programme row is
-- is_active = true. Turn a condition off in admin and no new enrolments can be
-- created for it, full stop — same structural-gate spirit as the activation
-- trigger in step 2.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'chronic_enrolment_status') then
    create type public.chronic_enrolment_status as enum ('enrolled', 'completed', 'withdrawn');
  end if;
  if not exists (select 1 from pg_type where typname = 'chronic_enrolment_source') then
    create type public.chronic_enrolment_source as enum ('recommended', 'staff', 'clinician');
  end if;
end;
$$;

create table if not exists public.chronic_programme_enrolments (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  programme_id     uuid not null references public.chronic_condition_programmes (id) on delete restrict,
  care_plan_id     uuid references public.care_plans (id) on delete set null,
  status           public.chronic_enrolment_status not null default 'enrolled',
  source           public.chronic_enrolment_source not null default 'clinician',
  notes            text,
  enrolled_at      timestamptz not null default now(),
  withdrawn_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists chronic_enrolments_patient_idx
  on public.chronic_programme_enrolments (patient_id);
create index if not exists chronic_enrolments_org_idx
  on public.chronic_programme_enrolments (organisation_id, status);
create index if not exists chronic_enrolments_programme_idx
  on public.chronic_programme_enrolments (programme_id);
-- At most one active enrolment per patient+programme.
create unique index if not exists chronic_enrolments_one_active
  on public.chronic_programme_enrolments (patient_id, programme_id)
  where status = 'enrolled';

drop trigger if exists chronic_enrolments_set_updated_at on public.chronic_programme_enrolments;
create trigger chronic_enrolments_set_updated_at
  before update on public.chronic_programme_enrolments
  for each row execute function private.set_updated_at();

-- --- phased-rollout gate ------------------------------------------------------
-- Reject enrolment into a condition that is not live. Only blocks the
-- transition INTO an active enrolment; withdrawing/completing is always allowed.
create or replace function private.enforce_chronic_enrolment_active_programme()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active boolean;
  v_code   text;
begin
  if new.status = 'enrolled' then
    select is_active, code into v_active, v_code
      from public.chronic_condition_programmes
     where id = new.programme_id;
    if v_active is distinct from true then
      raise exception
        'Cannot enrol: chronic condition "%" is not currently active on the platform.',
        coalesce(v_code, new.programme_id::text)
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists chronic_enrolments_active_gate on public.chronic_programme_enrolments;
create trigger chronic_enrolments_active_gate
  before insert or update on public.chronic_programme_enrolments
  for each row execute function private.enforce_chronic_enrolment_active_programme();

-- --- RLS ---------------------------------------------------------------------
alter table public.chronic_programme_enrolments enable row level security;

-- Patient reads own enrolments; staff read + write within their org.
drop policy if exists chronic_enrolments_select on public.chronic_programme_enrolments;
create policy chronic_enrolments_select on public.chronic_programme_enrolments
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists chronic_enrolments_insert on public.chronic_programme_enrolments;
create policy chronic_enrolments_insert on public.chronic_programme_enrolments
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

drop policy if exists chronic_enrolments_update on public.chronic_programme_enrolments;
create policy chronic_enrolments_update on public.chronic_programme_enrolments
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

drop policy if exists chronic_enrolments_delete on public.chronic_programme_enrolments;
create policy chronic_enrolments_delete on public.chronic_programme_enrolments
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.chronic_programme_enrolments to authenticated;
