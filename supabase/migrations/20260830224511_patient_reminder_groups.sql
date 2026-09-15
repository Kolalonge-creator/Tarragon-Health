-- Chronic disease monitoring §1.3: doctor-configurable reading-entry
-- reminder frequency and patient grouping.
--
-- A doctor should be able to group their patients (by risk level, by how
-- recently they were titrated, or any other grouping useful to them) and set
-- the reminder cadence for a group or an individual, overriding the
-- programme default from vitals_reminder_weekly_default.sql. This adds a
-- third scope tier — group — alongside the existing patient/condition/global
-- tiers in vitals_reminder_rules, and gives clinicians (not just admins)
-- write access, but only to the patient/group tiers: condition/global stay
-- admin-only, unchanged.
--
-- Groups are org-scoped and shared across every clinician in the org (not
-- owned exclusively by whoever created one) — matching the platform's
-- shift-covered-care-team model where no single doctor exclusively owns a
-- patient (see CLAUDE.md's Clinical Tier Ladder). `created_by` is provenance
-- only, not an access-control column.

-- ---------------------------------------------------------------------------
-- patient_reminder_groups / patient_reminder_group_members
-- ---------------------------------------------------------------------------

create table public.patient_reminder_groups (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  created_by        uuid references public.profiles (id) on delete set null,
  name              text not null check (char_length(btrim(name)) > 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index patient_reminder_groups_org_idx on public.patient_reminder_groups (organisation_id);

create trigger patient_reminder_groups_set_updated_at
  before update on public.patient_reminder_groups
  for each row execute function private.set_updated_at();

alter table public.patient_reminder_groups enable row level security;

create table public.patient_reminder_group_members (
  group_id    uuid not null references public.patient_reminder_groups (id) on delete cascade,
  patient_id  uuid not null references public.profiles (id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (group_id, patient_id)
);

create index patient_reminder_group_members_patient_idx
  on public.patient_reminder_group_members (patient_id);

alter table public.patient_reminder_group_members enable row level security;

-- Any clinician in the group's org may see/manage it — a shared roster, not
-- a private list. Membership add/remove additionally proves the patient is
-- in that same org (see below) so a group can never straddle two orgs.
create policy patient_reminder_groups_select
  on public.patient_reminder_groups for select
  to authenticated
  using (
    private.is_admin()
    or exists (
      select 1 from public.profiles staff
      where staff.id = (select auth.uid())
        and staff.role = 'clinician'
        and staff.organisation_id = patient_reminder_groups.organisation_id
    )
  );

create policy patient_reminder_groups_insert
  on public.patient_reminder_groups for insert
  to authenticated
  with check (
    private.is_admin()
    or exists (
      select 1 from public.profiles staff
      where staff.id = (select auth.uid())
        and staff.role = 'clinician'
        and staff.organisation_id = patient_reminder_groups.organisation_id
    )
  );

create policy patient_reminder_groups_update
  on public.patient_reminder_groups for update
  to authenticated
  using (
    private.is_admin()
    or exists (
      select 1 from public.profiles staff
      where staff.id = (select auth.uid())
        and staff.role = 'clinician'
        and staff.organisation_id = patient_reminder_groups.organisation_id
    )
  )
  with check (
    private.is_admin()
    or exists (
      select 1 from public.profiles staff
      where staff.id = (select auth.uid())
        and staff.role = 'clinician'
        and staff.organisation_id = patient_reminder_groups.organisation_id
    )
  );

create policy patient_reminder_groups_delete
  on public.patient_reminder_groups for delete
  to authenticated
  using (
    private.is_admin()
    or exists (
      select 1 from public.profiles staff
      where staff.id = (select auth.uid())
        and staff.role = 'clinician'
        and staff.organisation_id = patient_reminder_groups.organisation_id
    )
  );

create policy patient_reminder_group_members_select
  on public.patient_reminder_group_members for select
  to authenticated
  using (
    private.is_admin()
    or exists (
      select 1 from public.patient_reminder_groups g
      join public.profiles staff
        on staff.id = (select auth.uid())
       and staff.role = 'clinician'
       and staff.organisation_id = g.organisation_id
      where g.id = patient_reminder_group_members.group_id
    )
  );

-- Insert requires the caller be a clinician of the group's org AND the
-- patient being added actually belong to that same org — without the
-- second half, a clinician could add a foreign-org patient into a group
-- every clinician in their own org can see, leaking that patient's identity
-- across the tenant boundary.
create policy patient_reminder_group_members_insert
  on public.patient_reminder_group_members for insert
  to authenticated
  with check (
    private.is_admin()
    or (
      exists (
        select 1 from public.patient_reminder_groups g
        join public.profiles staff
          on staff.id = (select auth.uid())
         and staff.role = 'clinician'
         and staff.organisation_id = g.organisation_id
        where g.id = patient_reminder_group_members.group_id
      )
      and exists (
        select 1 from public.patient_reminder_groups g
        join public.profiles pt
          on pt.id = patient_reminder_group_members.patient_id
         and pt.role = 'patient'
         and pt.organisation_id = g.organisation_id
        where g.id = patient_reminder_group_members.group_id
      )
    )
  );

create policy patient_reminder_group_members_delete
  on public.patient_reminder_group_members for delete
  to authenticated
  using (
    private.is_admin()
    or exists (
      select 1 from public.patient_reminder_groups g
      join public.profiles staff
        on staff.id = (select auth.uid())
       and staff.role = 'clinician'
       and staff.organisation_id = g.organisation_id
      where g.id = patient_reminder_group_members.group_id
    )
  );

-- ---------------------------------------------------------------------------
-- vitals_reminder_rules: add the group scope tier
-- ---------------------------------------------------------------------------

alter table public.vitals_reminder_rules
  add column group_id uuid references public.patient_reminder_groups (id) on delete cascade;

alter table public.vitals_reminder_rules
  drop constraint vitals_reminder_rules_single_scope;

alter table public.vitals_reminder_rules
  add constraint vitals_reminder_rules_single_scope
  check (num_nonnulls(patient_id, condition, group_id) <= 1);

-- The pre-existing global-tier index only excluded patient_id/condition, so
-- an untouched group-scoped row (patient_id and condition both null) would
-- have collided with it, capping the org to one row total across the global
-- and group tiers combined. Recreate it scoped to true global rows only.
drop index public.vitals_reminder_rules_global_uidx;

create unique index vitals_reminder_rules_global_uidx
  on public.vitals_reminder_rules (organisation_id)
  where patient_id is null and condition is null and group_id is null;

create unique index vitals_reminder_rules_group_uidx
  on public.vitals_reminder_rules (organisation_id, group_id)
  where group_id is not null;

-- ---------------------------------------------------------------------------
-- RLS: let a clinician manage patient/group-scope rules for their own org's
-- patients/groups — condition/global tiers remain admin-only (untouched).
-- role = 'clinician' rather than private.is_org_staff(): that helper still
-- admits care_coordinator, and setting clinical monitoring cadence is a
-- clinical decision the Coordinator role must not get (CLAUDE.md's Clinical
-- Tier Ladder). No 'doctor' role exists any more to also match — it was
-- merged into 'clinician' platform-wide (20260803005139).
-- ---------------------------------------------------------------------------

create policy vitals_reminder_rules_clinician_select
  on public.vitals_reminder_rules for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles staff
      where staff.id = (select auth.uid())
        and staff.role = 'clinician'
        and staff.organisation_id = vitals_reminder_rules.organisation_id
    )
  );

create policy vitals_reminder_rules_clinician_insert
  on public.vitals_reminder_rules for insert
  to authenticated
  with check (
    (patient_id is not null or group_id is not null)
    and exists (
      select 1 from public.profiles staff
      where staff.id = (select auth.uid())
        and staff.role = 'clinician'
        and staff.organisation_id = vitals_reminder_rules.organisation_id
    )
    and (
      patient_id is null
      or exists (
        select 1 from public.profiles pt
        where pt.id = vitals_reminder_rules.patient_id
          and pt.organisation_id = vitals_reminder_rules.organisation_id
      )
    )
    and (
      group_id is null
      or exists (
        select 1 from public.patient_reminder_groups g
        where g.id = vitals_reminder_rules.group_id
          and g.organisation_id = vitals_reminder_rules.organisation_id
      )
    )
  );

create policy vitals_reminder_rules_clinician_update
  on public.vitals_reminder_rules for update
  to authenticated
  using (
    (patient_id is not null or group_id is not null)
    and exists (
      select 1 from public.profiles staff
      where staff.id = (select auth.uid())
        and staff.role = 'clinician'
        and staff.organisation_id = vitals_reminder_rules.organisation_id
    )
  )
  with check (
    (patient_id is not null or group_id is not null)
    and exists (
      select 1 from public.profiles staff
      where staff.id = (select auth.uid())
        and staff.role = 'clinician'
        and staff.organisation_id = vitals_reminder_rules.organisation_id
    )
    and (
      patient_id is null
      or exists (
        select 1 from public.profiles pt
        where pt.id = vitals_reminder_rules.patient_id
          and pt.organisation_id = vitals_reminder_rules.organisation_id
      )
    )
    and (
      group_id is null
      or exists (
        select 1 from public.patient_reminder_groups g
        where g.id = vitals_reminder_rules.group_id
          and g.organisation_id = vitals_reminder_rules.organisation_id
      )
    )
  );

create policy vitals_reminder_rules_clinician_delete
  on public.vitals_reminder_rules for delete
  to authenticated
  using (
    (patient_id is not null or group_id is not null)
    and exists (
      select 1 from public.profiles staff
      where staff.id = (select auth.uid())
        and staff.role = 'clinician'
        and staff.organisation_id = vitals_reminder_rules.organisation_id
    )
  );

-- ---------------------------------------------------------------------------
-- private.queue_vitals_reminders(): add the group tier to the precedence
-- chain — patient rule > min(group rule) > min(condition rule) > org global
-- > hardcoded fallback.
-- ---------------------------------------------------------------------------

create or replace function private.queue_vitals_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with freq as (
    select
      p.id as patient_id,
      p.organisation_id,
      p.created_at,
      coalesce(
        (select r.frequency_days from public.vitals_reminder_rules r
           where r.patient_id = p.id),
        (select min(r.frequency_days) from public.vitals_reminder_rules r
           join public.patient_reminder_group_members m
             on m.group_id = r.group_id
            and m.patient_id = p.id
           where r.patient_id is null
             and r.group_id is not null
             and r.organisation_id = p.organisation_id),
        (select min(r.frequency_days) from public.vitals_reminder_rules r
           join public.care_plans cp
             on cp.condition = r.condition
            and cp.patient_id = p.id
            and cp.status = 'active'
           where r.patient_id is null
             and r.condition is not null
             and r.organisation_id = p.organisation_id),
        (select r.frequency_days from public.vitals_reminder_rules r
           where r.patient_id is null
             and r.condition is null
             and r.group_id is null
             and r.organisation_id = p.organisation_id),
        case when exists (
          select 1 from public.care_plans cp
          where cp.patient_id = p.id
            and cp.status = 'active'
            and cp.condition in ('hypertension', 'diabetes')
        ) then 7 else 30 end
      ) as frequency_days
    from public.profiles p
    where p.role = 'patient' and p.organisation_id is not null
  ),
  candidates as (
    select
      f.patient_id,
      f.organisation_id,
      f.frequency_days,
      greatest(
        coalesce(
          (select max(v.taken_at)::date from public.vitals_readings v where v.patient_id = f.patient_id),
          f.created_at::date
        ) + (f.frequency_days || ' days')::interval,
        coalesce(
          (select s.next_due_at from public.vitals_reminder_state s where s.patient_id = f.patient_id),
          '-infinity'::date
        )
      ) as effective_due
    from freq f
  ),
  due as (
    select * from candidates where effective_due <= current_date
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id,
      patient_id,
      'whatsapp',
      'pending',
      'vitals_reminder',
      jsonb_build_object('frequency_days', frequency_days, 'due_date', effective_due)
    from due
    returning recipient_id
  )
  insert into public.vitals_reminder_state (patient_id, organisation_id, next_due_at, reminder_sent_at)
  select patient_id, organisation_id, current_date + frequency_days, now()
  from due
  on conflict (patient_id) do update
    set next_due_at = excluded.next_due_at,
        reminder_sent_at = excluded.reminder_sent_at,
        updated_at = now();
$$;

-- ---------------------------------------------------------------------------
-- Assert
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'vitals_reminder_rules'
       and policyname = 'vitals_reminder_rules_clinician_insert'
  ) then
    raise exception 'a clinician cannot set a patient/group reminder frequency';
  end if;

  if exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'vitals_reminder_rules'
       and indexname = 'vitals_reminder_rules_global_uidx'
       and indexdef not ilike '%group_id is null%'
  ) then
    raise exception 'the global-tier index must exclude group-scoped rows';
  end if;
end $$;
