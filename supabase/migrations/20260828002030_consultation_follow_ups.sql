-- Tarragon Health — Consultation System §9.16 "consultation -> care-plan
-- connector" and §9.22 acceptance criteria ("...follow-up created where
-- required -> care plan updated"). The spec calls this connector out as
-- critical: a doctor's spoken plan ("check BP twice weekly for four weeks",
-- "repeat HbA1c in three months", "specialist referral") must actually
-- create the corresponding downstream record, not just sit as prose in a
-- note.
--
-- Deliberately NOT a new parallel engine. Each follow-up type routes into
-- the engine that already owns that kind of work, same "never rebuild X as
-- a parallel record" discipline CLAUDE.md states for the Annual Health
-- Review:
--   * monitoring_schedule -> a patient-scoped override row on the existing
--     vitals_reminder_rules cadence engine (20260706001528_vitals_reminders.sql).
--   * referral            -> a real row in specialist_referrals
--     (20260705211237_prevention.sql), origin='clinically_triggered'.
--   * investigation / follow_up_appointment / care_plan_review -> these are
--     Care Coordinator logistics (book a lab test, book a follow-up slot,
--     revisit the structured care plan), not a clinical decision, so they
--     land as a normal row on the existing care_outreach_tasks worklist
--     (20260723010019_care_outreach_engine.sql) a coordinator already checks
--     daily, trigger_type='consultation_follow_up' (added in
--     20260827235757_consultation_system_enum_additions.sql).
--
-- consultation_follow_ups itself is the auditable bridge: one row per
-- instruction on a clinical_encounter_notes plan, immutable once
-- actioned/not_needed, so "the doctor said X" and "the system did Y about
-- it" are both provable from data — never just prose.
--
-- Authority split, matching the Clinical Tier Ladder exactly: creating a
-- follow-up instruction, and actioning a monitoring_schedule or referral
-- follow-up (both clinical decisions — a cadence or a specialist referral),
-- require clinical tier. Actioning an investigation/follow_up_appointment/
-- care_plan_review follow-up, and dismissing any follow-up as not_needed,
-- is logistics — any org staff member, Care Coordinator included, may do
-- it. Enforced in the write trigger below, never by which dashboard a
-- login can reach.

create table public.consultation_follow_ups (
  id                             uuid primary key default gen_random_uuid(),
  organisation_id                uuid not null references public.organisations (id) on delete restrict,
  patient_id                     uuid not null references public.profiles (id) on delete cascade,
  encounter_note_id              uuid not null references public.clinical_encounter_notes (id) on delete cascade,

  action_type                    text not null check (action_type in (
    'monitoring_schedule', 'investigation', 'referral', 'follow_up_appointment', 'care_plan_review'
  )),
  description                    text not null check (length(btrim(description)) > 0),
  structured_params              jsonb not null default '{}'::jsonb,
  due_at                         timestamptz,

  status                         text not null default 'pending' check (status in ('pending', 'actioned', 'not_needed')),
  resolution_note                text,

  created_by_staff               uuid references public.clinical_staff (id) on delete restrict,
  actioned_by_staff              uuid references public.clinical_staff (id) on delete set null,
  actioned_at                    timestamptz,

  linked_vitals_reminder_rule_id uuid references public.vitals_reminder_rules (id) on delete set null,
  linked_referral_id             uuid references public.specialist_referrals (id) on delete set null,
  linked_outreach_task_id        uuid references public.care_outreach_tasks (id) on delete set null,

  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),

  constraint consultation_follow_ups_resolved_requires_stamp check (
    status = 'pending' or (actioned_by_staff is not null and actioned_at is not null)
  ),
  constraint consultation_follow_ups_pending_is_clean check (
    status <> 'pending' or (actioned_by_staff is null and actioned_at is null)
  ),
  constraint consultation_follow_ups_not_needed_requires_reason check (
    status <> 'not_needed' or (resolution_note is not null and length(btrim(resolution_note)) > 0)
  ),
  -- Once actioned, the correct downstream row must actually be linked --
  -- this is the assertion that closes the "never let it fail silently" loop.
  constraint consultation_follow_ups_actioned_is_linked check (
    status <> 'actioned' or (
      (action_type = 'monitoring_schedule' and linked_vitals_reminder_rule_id is not null)
      or (action_type = 'referral' and linked_referral_id is not null)
      or (action_type in ('investigation', 'follow_up_appointment', 'care_plan_review') and linked_outreach_task_id is not null)
    )
  )
);

comment on table public.consultation_follow_ups is
  'Consultation System §9.16/§9.22 -- one row per follow-up instruction on a clinical_encounter_notes plan. Not a parallel worklist: actioning a row creates/links the real downstream record (vitals_reminder_rules / specialist_referrals / care_outreach_tasks). Immutable once actioned or not_needed.';

create index consultation_follow_ups_patient_idx on public.consultation_follow_ups (patient_id, created_at desc);
create index consultation_follow_ups_org_status_idx on public.consultation_follow_ups (organisation_id, status);
create index consultation_follow_ups_note_idx on public.consultation_follow_ups (encounter_note_id);

create trigger consultation_follow_ups_set_updated_at
  before update on public.consultation_follow_ups
  for each row execute function private.set_updated_at();

alter table public.consultation_follow_ups enable row level security;

create policy consultation_follow_ups_select on public.consultation_follow_ups
  for select to authenticated
  using (private.is_org_staff(organisation_id));

-- Broad here, narrowed by the write trigger below -- same "RLS admits, the
-- trigger narrows" shape as clinical_encounter_notes/case_review_actions.
create policy consultation_follow_ups_insert on public.consultation_follow_ups
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

create policy consultation_follow_ups_update on public.consultation_follow_ups
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

-- No DELETE policy: once written, a follow-up instruction is retained,
-- same discipline as clinical_encounter_notes.
grant select, insert, update on public.consultation_follow_ups to authenticated;
revoke delete on public.consultation_follow_ups from authenticated;

-- ---------------------------------------------------------------------------
-- Forge-proof write trigger.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_consultation_follow_up_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note        record;
  v_staff_id    uuid;
  v_needs_tier  boolean;
begin
  if tg_op = 'INSERT' then
    select id, organisation_id, patient_id into v_note
    from public.clinical_encounter_notes
    where id = new.encounter_note_id;
    if v_note.id is null then
      raise exception 'encounter note not found';
    end if;
    if not private.is_clinical_tier(v_note.organisation_id) then
      raise exception 'Only a clinical-tier member of the care team can record a consultation follow-up.'
        using errcode = '42501';
    end if;

    select id into v_staff_id
    from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = v_note.organisation_id
      and active
    limit 1;

    -- Client-supplied linkage/scope is never trusted -- always re-derived
    -- from the encounter note itself.
    new.organisation_id := v_note.organisation_id;
    new.patient_id := v_note.patient_id;
    new.created_by_staff := v_staff_id;
    new.status := 'pending';
    new.resolution_note := null;
    new.actioned_by_staff := null;
    new.actioned_at := null;
    new.linked_vitals_reminder_rule_id := null;
    new.linked_referral_id := null;
    new.linked_outreach_task_id := null;
    return new;
  end if;

  -- UPDATE: immutable once resolved.
  if old.status in ('actioned', 'not_needed') then
    raise exception 'This follow-up has already been resolved and cannot be edited.'
      using errcode = '42501';
  end if;

  -- Scope/link/authorship columns are never retroactively rewritable.
  new.organisation_id := old.organisation_id;
  new.patient_id := old.patient_id;
  new.encounter_note_id := old.encounter_note_id;
  new.action_type := old.action_type;
  new.created_by_staff := old.created_by_staff;

  if new.status = old.status then
    -- Editing description/due_at/structured_params on a still-pending row.
    if not private.is_org_staff(new.organisation_id) then
      raise exception 'Only care-team staff may edit a consultation follow-up.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Transitioning pending -> actioned or pending -> not_needed.
  v_needs_tier := new.action_type in ('monitoring_schedule', 'referral');
  if v_needs_tier and new.status = 'actioned' then
    if not private.is_clinical_tier(new.organisation_id) then
      raise exception 'Only a clinical-tier member of the care team can action a % follow-up.', new.action_type
        using errcode = '42501';
    end if;
  elsif not private.is_org_staff(new.organisation_id) then
    raise exception 'Only care-team staff may resolve a consultation follow-up.'
      using errcode = '42501';
  end if;

  select id into v_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active
  limit 1;
  if v_staff_id is null then
    raise exception 'Only an active member of the care team can resolve a consultation follow-up.'
      using errcode = '42501';
  end if;

  new.actioned_by_staff := v_staff_id;
  new.actioned_at := now();
  return new;
end;
$$;

comment on function private.enforce_consultation_follow_up_write() is
  'INSERT: derives organisation_id/patient_id/created_by_staff from the encounter note, requires clinical tier. UPDATE: blocks editing a resolved row, keeps scope/authorship immutable, requires clinical tier to action monitoring_schedule/referral (any staff for the rest), server-stamps actioned_by_staff/actioned_at.';

create trigger consultation_follow_ups_enforce_write
  before insert or update on public.consultation_follow_ups
  for each row execute function private.enforce_consultation_follow_up_write();

revoke all on function private.enforce_consultation_follow_up_write() from public, anon;

-- ---------------------------------------------------------------------------
-- action_consultation_follow_up -- the one path that turns a pending
-- follow-up into a real downstream record. SECURITY DEFINER because the
-- monitoring_schedule branch needs to write vitals_reminder_rules, which is
-- otherwise admin-only (private.is_admin()) -- a doctor setting a temporary
-- monitoring cadence from a consultation is not an admin action, so this
-- RPC is the narrow, audited door into that table for this one purpose.
-- ---------------------------------------------------------------------------
create or replace function public.action_consultation_follow_up(
  p_followup_id uuid,
  p_monitoring_frequency_days integer default null,
  p_referral_specialist_type text default null,
  p_referral_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fu       record;
  v_staff    record;
  v_new_id   uuid;
  v_specialist public.specialist_type;
begin
  select * into v_fu from public.consultation_follow_ups where id = p_followup_id for update;
  if v_fu.id is null then
    raise exception 'follow-up not found';
  end if;
  if v_fu.status <> 'pending' then
    raise exception 'this follow-up has already been resolved (status: %)', v_fu.status;
  end if;

  select cs.* into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = v_fu.organisation_id
    and cs.active;
  if v_staff.id is null then
    raise exception 'only an active member of this organisation''s care team can action a follow-up'
      using errcode = '42501';
  end if;

  if v_fu.action_type in ('monitoring_schedule', 'referral')
     and not (v_staff.is_clinical_director or v_staff.doctor_tier in
       ('tier_1', 'tier_2', 'tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')) then
    raise exception 'only a clinical-tier member of the care team can action a % follow-up', v_fu.action_type
      using errcode = '42501';
  end if;

  if v_fu.action_type = 'monitoring_schedule' then
    if p_monitoring_frequency_days is null or p_monitoring_frequency_days <= 0 or p_monitoring_frequency_days > 90 then
      raise exception 'a monitoring schedule needs a frequency between 1 and 90 days';
    end if;

    insert into public.vitals_reminder_rules (organisation_id, patient_id, frequency_days)
    values (v_fu.organisation_id, v_fu.patient_id, p_monitoring_frequency_days)
    on conflict (organisation_id, patient_id) where patient_id is not null
      do update set frequency_days = excluded.frequency_days
    returning id into v_new_id;

    update public.consultation_follow_ups
      set status = 'actioned', linked_vitals_reminder_rule_id = v_new_id
      where id = p_followup_id;

  elsif v_fu.action_type = 'referral' then
    if p_referral_specialist_type is null then
      raise exception 'a referral follow-up needs a specialist type';
    end if;
    begin
      v_specialist := p_referral_specialist_type::public.specialist_type;
    exception when invalid_text_representation then
      raise exception '% is not a recognised specialist type', p_referral_specialist_type;
    end;

    insert into public.specialist_referrals
      (organisation_id, patient_id, specialist_type, referral_reason, origin, set_by)
    values
      (v_fu.organisation_id, v_fu.patient_id, v_specialist,
       coalesce(nullif(btrim(p_referral_reason), ''), v_fu.description),
       'clinically_triggered', v_staff.profile_id)
    returning id into v_new_id;

    update public.consultation_follow_ups
      set status = 'actioned', linked_referral_id = v_new_id
      where id = p_followup_id;

  else
    -- investigation / follow_up_appointment / care_plan_review: Care
    -- Coordinator logistics, routed onto the existing outreach worklist.
    -- care_outreach_tasks allows only one LIVE row per (patient, trigger_type)
    -- (care_outreach_tasks_live_unique) -- if this patient already has an
    -- open consultation_follow_up task, this merges the new instruction into
    -- it (returning that task's id) instead of raising a conflict error or
    -- silently doing nothing and leaving nothing to link.
    insert into public.care_outreach_tasks
      (organisation_id, patient_id, trigger_type, trigger_detail, priority)
    values
      (v_fu.organisation_id, v_fu.patient_id, 'consultation_follow_up',
       jsonb_build_object(
         'action_type', v_fu.action_type,
         'description', v_fu.description,
         'encounter_note_id', v_fu.encounter_note_id,
         'due_at', v_fu.due_at
       ),
       2)
    on conflict (patient_id, trigger_type) where status in ('open', 'in_progress', 'contacted')
      do update set trigger_detail = public.care_outreach_tasks.trigger_detail || excluded.trigger_detail
    returning id into v_new_id;

    update public.consultation_follow_ups
      set status = 'actioned', linked_outreach_task_id = v_new_id
      where id = p_followup_id;
  end if;

  return jsonb_build_object('follow_up_id', p_followup_id, 'action_type', v_fu.action_type, 'linked_id', v_new_id);
end;
$$;

create or replace function public.mark_consultation_follow_up_not_needed(
  p_followup_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fu record;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'say why this follow-up is not needed';
  end if;

  select * into v_fu from public.consultation_follow_ups where id = p_followup_id for update;
  if v_fu.id is null then
    raise exception 'follow-up not found';
  end if;
  if v_fu.status <> 'pending' then
    raise exception 'this follow-up has already been resolved (status: %)', v_fu.status;
  end if;
  if not private.is_org_staff(v_fu.organisation_id) then
    raise exception 'only care-team staff may resolve a consultation follow-up'
      using errcode = '42501';
  end if;

  update public.consultation_follow_ups
    set status = 'not_needed', resolution_note = btrim(p_reason)
    where id = p_followup_id;
end;
$$;

revoke execute on function public.action_consultation_follow_up(uuid, integer, text, text) from public, anon;
revoke execute on function public.mark_consultation_follow_up_not_needed(uuid, text) from public, anon;
grant execute on function public.action_consultation_follow_up(uuid, integer, text, text) to authenticated;
grant execute on function public.mark_consultation_follow_up_not_needed(uuid, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.action_consultation_follow_up(uuid, integer, text, text)', 'EXECUTE') then
    raise exception 'anon must not execute action_consultation_follow_up';
  end if;
  if has_function_privilege('anon', 'public.mark_consultation_follow_up_not_needed(uuid, text)', 'EXECUTE') then
    raise exception 'anon must not execute mark_consultation_follow_up_not_needed';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'consultation_follow_ups' and cmd = 'DELETE'
  ) then
    raise exception 'consultation_follow_ups must have no DELETE policy';
  end if;
  raise notice 'PASS: consultation_follow_ups table + RPCs + ACLs present';
end $$;
