-- ===========================================================================
-- PD-06 / P13 (founder, 2026-11-06, Q4): the patient care plan gains review dates, action categories with why/when/how,
-- and a "what changed" record per published version with an optional patient acknowledgement.
--
-- Row counts before this migration (live koiplnmbgnqnbywhpjlf, 2026-11-07): care_plans 0, care_plan_interventions 0,
-- care_plan_versions 0. So this is a pure structural change; no data needs converting.
--
-- What it adds:
--   1. care_plans.last_reviewed_at (timestamptz) and care_plans.next_review_at (date). Written by staff through the existing
--      care_plans UPDATE policy (private.staff_may_write ... 'appointments_care_plan'); every change is already snapshotted
--      into care_plan_versions by care_plans_snapshot_version.
--   2. care_plan_action_category enum (goals, tests, monitoring, medicines, lifestyle, screening, consultations, follow_up) and,
--      on care_plan_interventions (the plan's actions), category + why_text / when_text / how_text. Written through the
--      existing care_plan_interventions INSERT/UPDATE policies (staff_may_write).
--   3. care_plan_revisions: one row per published version of a plan. It keeps a frozen snapshot of the plan and its active
--      actions, the doctor's plain-words "what changed" note, whether the patient must acknowledge it, and who acknowledged
--      it and when. No INSERT/UPDATE/DELETE policy at all: rows are written only by two SECURITY DEFINER functions:
--        - public.publish_care_plan_revision(): the caller must pass private.staff_may_write for this patient AND be an
--          active doctor (private.follow_up_actor_is_clinician: active clinical_staff, tier set, not a care coordinator).
--        - public.acknowledge_care_plan_revision(): only the patient themself (auth.uid() = patient_id). A supporter acting
--          for them (profile_access, Care Circle, a guardian's manage grant) is a different auth.uid() and is refused.
--   Reads mirror care_plans' own SELECT policy (patient, staff_may_read, category grant, emergency access, the caregiver
--   view_care_plan permission), with explicit enum casts on every can_read_clinical call (CLAUDE.md overload lesson).
--   Not reproductive data; no reproductive category involved.
-- ===========================================================================

-- 1. Review dates on the plan ----------------------------------------------------------------------------------------
alter table public.care_plans
  add column if not exists last_reviewed_at timestamptz,
  add column if not exists next_review_at date;

comment on column public.care_plans.last_reviewed_at is
  'PD-06: when a doctor last reviewed this plan. Set by staff; shown to the patient as "Last reviewed".';
comment on column public.care_plans.next_review_at is
  'PD-06: the date the next review is due. Set by staff; shown to the patient as "Next review".';

-- 2. Action categories and why / when / how --------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'care_plan_action_category') then
    create type public.care_plan_action_category as enum
      ('goals', 'tests', 'monitoring', 'medicines', 'lifestyle', 'screening', 'consultations', 'follow_up');
  end if;
end;
$$;

alter table public.care_plan_interventions
  add column if not exists category public.care_plan_action_category,
  add column if not exists why_text text,
  add column if not exists when_text text,
  add column if not exists how_text text;

alter table public.care_plan_interventions
  drop constraint if exists care_plan_interventions_why_len,
  drop constraint if exists care_plan_interventions_when_len,
  drop constraint if exists care_plan_interventions_how_len;
alter table public.care_plan_interventions
  add constraint care_plan_interventions_why_len check (why_text is null or char_length(why_text) between 1 and 500),
  add constraint care_plan_interventions_when_len check (when_text is null or char_length(when_text) between 1 and 300),
  add constraint care_plan_interventions_how_len check (how_text is null or char_length(how_text) between 1 and 500);

-- 3. Published versions with "what changed" and acknowledgement -----------------------------------------------------
create table if not exists public.care_plan_revisions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  patient_id uuid not null references public.profiles(id) on delete cascade,
  care_plan_id uuid not null references public.care_plans(id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  change_summary text not null check (char_length(btrim(change_summary)) between 5 and 600),
  needs_acknowledgement boolean not null default false,
  plan_snapshot jsonb not null,
  published_by uuid not null references public.profiles(id) on delete restrict,
  published_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles(id) on delete restrict,
  unique (care_plan_id, version_number),
  -- an acknowledgement exists only on a change that asked for one, and always names the patient as the one who gave it
  constraint care_plan_revisions_ack_shape check (
    (acknowledged_at is null and acknowledged_by is null)
    or (needs_acknowledgement and acknowledged_at is not null and acknowledged_by = patient_id)
  )
);

create index if not exists care_plan_revisions_patient_idx on public.care_plan_revisions (patient_id, published_at desc);
create index if not exists care_plan_revisions_plan_idx on public.care_plan_revisions (care_plan_id, version_number desc);
create index if not exists care_plan_revisions_unacked_idx on public.care_plan_revisions (patient_id)
  where needs_acknowledgement and acknowledged_at is null;

alter table public.care_plan_revisions enable row level security;

drop policy if exists care_plan_revisions_select on public.care_plan_revisions;
create policy care_plan_revisions_select on public.care_plan_revisions
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.staff_may_read(patient_id, organisation_id, 'appointments_care_plan'::public.care_access_category)
    or private.can_read_clinical(patient_id, 'appointments_care_plan'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'appointments_care_plan'::public.care_access_category)
    or private.can_read_clinical(patient_id, 'view_care_plan'::public.caregiver_permission)
  );

revoke all on public.care_plan_revisions from anon;
revoke all on public.care_plan_revisions from authenticated;
grant select on public.care_plan_revisions to authenticated;

-- registries (s39d data registry; rls_shape_gate staff-read scope, mirroring care_plans: tied, appointments_care_plan)
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
values ('care_plan_revisions', 'patient_id', 'clinical_record', 'review', true, false,
        'Each published version of a care plan: a frozen snapshot, the doctor''s plain-words what-changed note and the patient''s acknowledgement (PD-06). Class assigned by the migration author, not yet reviewed by the CMO and DPO.')
on conflict (table_name) do nothing;
insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason)
values ('care_plan_revisions', 'tied', 'patient_id', 'appointments_care_plan', 'Published versions of the care plan; same scope as care_plans.')
on conflict (table_name) do nothing;

comment on table public.care_plan_revisions is
  'PD-06: one row per published version of a care plan: a frozen snapshot, the doctor''s plain-words "what changed" note, '
  'whether the patient must acknowledge it, and the patient''s acknowledgement. Written only by '
  'publish_care_plan_revision() (doctor) and acknowledge_care_plan_revision() (the patient themself).';

-- publish: doctor only, through the existing write gate --------------------------------------------------------------
create or replace function public.publish_care_plan_revision(
  p_care_plan uuid,
  p_change_summary text,
  p_needs_acknowledgement boolean default false
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.care_plans%rowtype;
  v_next integer;
  v_id uuid;
  v_summary text := btrim(coalesce(p_change_summary, ''));
  v_snapshot jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to publish a care plan change' using errcode = '42501';
  end if;

  select * into v_plan from public.care_plans where id = p_care_plan;
  if not found then
    raise exception 'Care plan not found' using errcode = 'P0002';
  end if;

  if not private.staff_may_write(v_plan.patient_id, v_plan.organisation_id, 'appointments_care_plan'::public.care_access_category)
     or not private.follow_up_actor_is_clinician(v_plan.organisation_id) then
    raise exception 'Only a doctor caring for this patient can publish a care plan change' using errcode = '42501';
  end if;

  if char_length(v_summary) < 5 or char_length(v_summary) > 600 then
    raise exception 'Write what changed in 5 to 600 characters' using errcode = '22023';
  end if;

  -- serialise publishers of the same plan so version numbers never collide
  perform 1 from public.care_plans where id = p_care_plan for update;

  select coalesce(max(version_number), 0) + 1 into v_next
    from public.care_plan_revisions where care_plan_id = p_care_plan;

  v_snapshot := jsonb_build_object(
    'condition', v_plan.condition,
    'status', v_plan.status,
    'notes', v_plan.notes,
    'target_ranges', v_plan.target_ranges,
    'last_reviewed_at', v_plan.last_reviewed_at,
    'next_review_at', v_plan.next_review_at,
    'actions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'description', i.description,
               'frequency', i.frequency,
               'category', i.category,
               'why', i.why_text,
               'when', i.when_text,
               'how', i.how_text) order by i.created_at)
        from public.care_plan_interventions i
       where i.care_plan_id = p_care_plan and i.status = 'active'), '[]'::jsonb)
  );

  insert into public.care_plan_revisions
    (organisation_id, patient_id, care_plan_id, version_number, change_summary, needs_acknowledgement, plan_snapshot, published_by)
  values
    (v_plan.organisation_id, v_plan.patient_id, p_care_plan, v_next, v_summary, coalesce(p_needs_acknowledgement, false),
     v_snapshot, (select auth.uid()))
  returning id into v_id;

  return v_id;
end;
$$;

-- acknowledge: the patient themself only ----------------------------------------------------------------------------
create or replace function public.acknowledge_care_plan_revision(p_revision uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rev public.care_plan_revisions%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to confirm this change' using errcode = '42501';
  end if;

  select * into v_rev from public.care_plan_revisions where id = p_revision for update;
  -- a missing row and someone else's row look the same, so the function never confirms a row exists
  if not found or v_rev.patient_id <> (select auth.uid()) then
    raise exception 'Only the patient can confirm a change to their own care plan' using errcode = '42501';
  end if;

  if not v_rev.needs_acknowledgement then
    raise exception 'This change does not need confirming' using errcode = '22023';
  end if;

  if v_rev.acknowledged_at is not null then
    return true; -- already confirmed; a second click is harmless
  end if;

  update public.care_plan_revisions
     set acknowledged_at = now(), acknowledged_by = (select auth.uid())
   where id = p_revision;
  return true;
end;
$$;

revoke all on function public.publish_care_plan_revision(uuid, text, boolean) from public;
revoke all on function public.acknowledge_care_plan_revision(uuid) from public;
revoke all on function public.publish_care_plan_revision(uuid, text, boolean) from anon;
revoke all on function public.acknowledge_care_plan_revision(uuid) from anon;
grant execute on function public.publish_care_plan_revision(uuid, text, boolean) to authenticated;
grant execute on function public.acknowledge_care_plan_revision(uuid) to authenticated;

-- self-check ------------------------------------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.care_plan_revisions', 'SELECT') then
    raise exception 'self-check: anon can read care_plan_revisions';
  end if;
  if has_table_privilege('authenticated', 'public.care_plan_revisions', 'INSERT')
     or has_table_privilege('authenticated', 'public.care_plan_revisions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.care_plan_revisions', 'DELETE') then
    raise exception 'self-check: authenticated can write care_plan_revisions directly';
  end if;
  if has_function_privilege('anon', 'public.publish_care_plan_revision(uuid, text, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.acknowledge_care_plan_revision(uuid)', 'EXECUTE') then
    raise exception 'self-check: anon can execute a care plan revision function';
  end if;
end;
$$;

-- analytics_clean views copy column lists; rebuild so analytics_clean.care_plans picks up the two new review-date columns.
select private.rebuild_analytics_clean_views();
