-- Tarragon Health — Transition to adult care (Child Health Platform §48.14)
--
-- "Child -> Adolescent -> Transition preparation -> Young adult ->
-- Independent account. The transition should not suddenly remove the
-- historical record." Two parts:
--
--   1. A materialised transition_state per dependent (same "status projection
--      refreshed by a daily cron" shape as vaccination_schedules), purely
--      age-derived from date_of_birth, so the UI can render "preparing for
--      independence" messaging from 16 without any manual admin step.
--   2. The one concrete, automatic permission change: on turning 18, every
--      'manage' grant on that profile is stepped down to 'view' — a parent
--      keeps seeing the record (nothing is removed) but can no longer act for
--      an adult without being asked again. This does NOT touch
--      is_dependent_account (the record's login stays synthetic/unusable) —
--      claiming a real login is a separate, deliberate step
--      (activate_dependent_account_basics below), because turning 18 doesn't
--      hand anyone a working password.
--
-- Deliberately NOT built here: a granular per-record "hide this from my
-- parent" sensitivity flag for the adolescent stage. That would need a
-- product decision about which record types/categories qualify (e.g.
-- reproductive health) that nobody has made yet — see
-- docs/PEDIATRIC_CHILD_HEALTH_SPEC.md's follow-up list. What ships here is
-- the account-level access tapering only.
--
-- NOTE (2026-09-02 reconciliation): a separately-authored PR (#329,
-- Adolescent Health module) also introduces its own "transition to adult
-- care" concept — adolescent_transition_plans, a clinician-driven, staged
-- readiness checklist (transition_assessment -> independent_account_prep ->
-- health_literacy -> medication_independence -> adult_care_handoff), gated
-- on clinical-tier authority to advance a stage. That is NOT the same thing
-- as this migration's dependent_transition_status: this one is a purely
-- age-derived (13/16/18), automatic, non-clinical status used only to taper
-- profile_access from 'manage' to 'view' at 18 — no clinician ever acts on
-- it. Different table/enum/cron-job names mean there is no live SQL
-- collision between the two, but they cover real overlapping product
-- territory (both fire in the 13-18 age band, both are called "transition"
-- in patient-facing framing) and were built independently the same day. This
-- was flagged, not resolved here — reconciling the two "transition" concepts
-- (e.g. should dependent_transition_status become the automatic account-
-- access layer underneath adolescent_transition_plans's clinical checklist)
-- is a product decision for a human, not something to guess at mid-merge.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'dependent_transition_state') then
    create type public.dependent_transition_state as enum (
      'child', 'adolescent', 'transition_prep', 'independent'
    );
  end if;
end $$;

create table if not exists public.dependent_transition_status (
  patient_id        uuid primary key references public.profiles (id) on delete cascade,
  organisation_id   uuid references public.organisations (id) on delete cascade,
  transition_state  public.dependent_transition_state not null,
  computed_at       timestamptz not null default now()
);

alter table public.dependent_transition_status enable row level security;

drop policy if exists dependent_transition_status_select on public.dependent_transition_status;
create policy dependent_transition_status_select on public.dependent_transition_status
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or (organisation_id is not null and private.is_org_staff(organisation_id))
    or private.can_read_clinical(patient_id)
  );

grant select on public.dependent_transition_status to authenticated;

-- Pure age band, no clinical judgement — 13/16/18 are the spec's own named
-- stages, not a medical determination.
create or replace function private.compute_dependent_transition_state(p_dob date)
returns public.dependent_transition_state
language sql
stable
set search_path = ''
as $$
  select case
    when p_dob is null then null
    when extract(year from age(current_date, p_dob)) >= 18 then 'independent'
    when extract(year from age(current_date, p_dob)) >= 16 then 'transition_prep'
    when extract(year from age(current_date, p_dob)) >= 13 then 'adolescent'
    else 'child'
  end::public.dependent_transition_state;
$$;

revoke all on function private.compute_dependent_transition_state(date) from public;
grant execute on function private.compute_dependent_transition_state(date) to authenticated;

alter type public.timeline_event_type add value if not exists 'dependent_account_transitioned';

-- Refreshes every dependent's status; on a fresh crossing into 'independent'
-- (and only then — idempotent against the previously stored state, so a
-- daily re-run never repeats the downgrade or the timeline entry), steps
-- every 'manage' grant down to 'view' and records what happened where the
-- patient (now old enough to read their own timeline) can see it.
create or replace function private.refresh_dependent_transition_statuses()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
  v_new_state public.dependent_transition_state;
  v_old_state public.dependent_transition_state;
begin
  for v_profile in
    select id, organisation_id, date_of_birth, full_name
    from public.profiles
    where is_dependent_account and date_of_birth is not null
  loop
    v_new_state := private.compute_dependent_transition_state(v_profile.date_of_birth);

    select transition_state into v_old_state
    from public.dependent_transition_status
    where patient_id = v_profile.id;

    insert into public.dependent_transition_status (patient_id, organisation_id, transition_state, computed_at)
    values (v_profile.id, v_profile.organisation_id, v_new_state, now())
    on conflict (patient_id) do update
      set transition_state = excluded.transition_state,
          organisation_id = excluded.organisation_id,
          computed_at = excluded.computed_at;

    if v_new_state = 'independent'
       and coalesce(v_old_state, 'child'::public.dependent_transition_state) <> 'independent' then
      update public.profile_access
        set permission_level = 'view'
        where profile_id = v_profile.id and permission_level = 'manage';

      if v_profile.organisation_id is not null then
        insert into public.patient_timeline
          (organisation_id, patient_id, event_type, source_table, title, summary)
        values (
          v_profile.organisation_id, v_profile.id, 'dependent_account_transitioned',
          'dependent_transition_status',
          'Turned 18 — guardian access adjusted',
          format(
            'Guardian access on this record moved automatically from full management to view-only now that %s has turned 18. The full history is kept — nothing was removed. Activating an independent login is a separate step.',
            coalesce(v_profile.full_name, 'this account holder')
          )
        );
      end if;
    end if;
  end loop;
end;
$$;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'dependent-transition-status-daily') then
    perform cron.unschedule('dependent-transition-status-daily');
  end if;
end $$;

select cron.schedule(
  'dependent-transition-status-daily',
  '30 3 * * *',
  $$ select private.refresh_dependent_transition_statuses(); $$
);

-- Claiming a real, independent login is a deliberate action (the synthetic
-- dependent email has no usable password), not something turning 18 does by
-- itself. This flips the one flag that gates it; the actual auth.users email/
-- invite update happens in application code with the Supabase admin API
-- (createServiceRoleClient), same "service-role write, attributed via this
-- RPC" shape as provision_dependent_profile_basics
-- (20260812041044_service_role_write_actor_attribution.sql).
create or replace function public.activate_dependent_account_basics(
  p_child_id uuid,
  p_actor_id uuid
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform set_config('app.audit_actor_id', p_actor_id::text, true);
  update public.profiles
    set is_dependent_account = false
    where id = p_child_id;
end;
$$;

comment on function public.activate_dependent_account_basics(uuid, uuid) is
  'Service-role write wrapper: flips is_dependent_account off once a young adult (or their guardian, on their behalf) has supplied a real email for the account, attributed to whoever initiated it (p_actor_id). See 20260829123652_dependent_transition_to_adult_care.sql.';

revoke all on function public.activate_dependent_account_basics(uuid, uuid) from public;
revoke all on function public.activate_dependent_account_basics(uuid, uuid) from authenticated;
revoke all on function public.activate_dependent_account_basics(uuid, uuid) from anon;
grant execute on function public.activate_dependent_account_basics(uuid, uuid) to service_role;

-- Assertions.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'dependent_transition_state') then
    raise exception 'dependent_transition_state enum was not created';
  end if;
  if not exists (select 1 from cron.job where jobname = 'dependent-transition-status-daily') then
    raise exception 'dependent-transition-status-daily cron job was not scheduled';
  end if;
end $$;
