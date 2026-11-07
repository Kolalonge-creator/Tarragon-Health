-- ===========================================================================
-- G10: handing a case over to another doctor, with acknowledgement (spec 10.4; founder decisions DW-16..DW-19, 2026-11-07).
--
--   DW-16  The doctor the case is assigned to, or an active Chief Medical Officer, can hand it over to another active doctor.
--   DW-17  The current doctor keeps the case until the new doctor accepts. Nothing moves on the request alone, so a case is never
--          left without an owner (spec: critical cases must not disappear).
--   DW-18  The new doctor accepts or declines. A decline needs a reason. A handover nobody has answered is shown on the CMO's
--          oversight view after 60 minutes, or 15 minutes for an emergency-level case. No page is sent.
--   DW-19  A reason and the outstanding action are required, each at least 10 characters.
--
-- The record: public.escalation_handovers holds the previous owner, the new owner, who asked, the reason, the outstanding action,
-- the time asked, the acknowledge-by time and the answer (accepted, declined with a reason, cancelled, or superseded when the case
-- closed or was reassigned while it was waiting). No direct table access: written by request/respond/cancel, read by
-- escalation_handovers_for (one case) and open_escalation_handovers (the caller's waiting handovers; all of them for a CMO).
--
-- Accepting assigns the case to the accepting doctor, which the existing reassignment rule
-- (private.enforce_escalation_reassignment_authority) already allows for yourself, so that rule is not touched here.
--
-- Notices are in-app, non-clinical (INV-07): the payload carries only the case and handover ids.
-- ===========================================================================

-- 1. The record ------------------------------------------------------------------------------------------------------------------
create table public.escalation_handovers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  escalation_id uuid not null references public.escalations(id) on delete restrict,
  patient_id uuid not null references public.profiles(id) on delete restrict,
  from_profile_id uuid not null references public.profiles(id) on delete restrict,
  to_profile_id uuid not null references public.profiles(id) on delete restrict,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  outstanding_action text not null check (length(btrim(outstanding_action)) between 10 and 1000),
  is_critical boolean not null,
  requested_at timestamptz not null default now(),
  acknowledge_by timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'superseded')),
  responded_at timestamptz,
  responded_by uuid references public.profiles(id) on delete restrict,
  decline_reason text check (decline_reason is null or length(btrim(decline_reason)) between 10 and 1000),
  constraint escalation_handovers_not_to_self check (to_profile_id <> from_profile_id),
  constraint escalation_handovers_answer_shape check (
    (status = 'pending' and responded_at is null and responded_by is null and decline_reason is null)
    or (status = 'declined' and responded_at is not null and decline_reason is not null)
    or (status in ('accepted', 'cancelled', 'superseded') and responded_at is not null and decline_reason is null)
  )
);

-- One waiting handover per case at a time.
create unique index escalation_handovers_one_pending on public.escalation_handovers (escalation_id) where status = 'pending';
create index escalation_handovers_escalation_idx on public.escalation_handovers (escalation_id, requested_at desc);
create index escalation_handovers_pending_org_idx on public.escalation_handovers (organisation_id, acknowledge_by) where status = 'pending';

comment on table public.escalation_handovers is
  'G10 (DW-16..19): each handover of an escalation from one doctor to another and its answer. The case moves only when the new doctor accepts. Written and read only through the handover functions; no direct table access.';

alter table public.escalation_handovers enable row level security;
revoke all on table public.escalation_handovers from public, anon, authenticated;

-- 2. Helpers --------------------------------------------------------------------------------------------------------------------
-- An emergency-level case: the same "level OR override_level is emergency" predicate the emergency-tier trigger uses.
create or replace function private.escalation_is_critical(p_escalation public.escalations)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce((
    select coalesce(ca.level = 'emergency', false) or coalesce(ca.override_level = 'emergency', false)
      from public.clinician_alerts ca where ca.id = p_escalation.clinician_alert_id
  ), false);
$function$;

revoke all on function private.escalation_is_critical(public.escalations) from public, anon, authenticated;

create or replace function private.is_active_cmo(p_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select (select auth.uid()) is not null and exists (
    select 1 from public.clinical_staff cs
     where cs.profile_id = (select auth.uid()) and cs.organisation_id = p_organisation_id
       and cs.active and cs.doctor_tier = 'chief_medical_officer'
  );
$function$;

revoke all on function private.is_active_cmo(uuid) from public, anon, authenticated;

create or replace function private.notify_escalation_handover(p_handover public.escalation_handovers, p_template text, p_recipients uuid[])
returns void
language sql
security definer
set search_path to ''
as $function$
  insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
  select r, p_handover.organisation_id, 'in_app', p_template,
         jsonb_build_object('escalation_id', p_handover.escalation_id, 'handover_id', p_handover.id),
         'pending', 'non_clinical', 'routine', 'escalation_handovers', p_handover.id
    from (select distinct u as r from unnest(p_recipients) as u) as recipients
   where r is not null and r is distinct from (select auth.uid());
$function$;

revoke all on function private.notify_escalation_handover(public.escalation_handovers, text, uuid[]) from public, anon, authenticated;

-- 3. Ask -----------------------------------------------------------------------------------------------------------------------
create or replace function public.request_escalation_handover(
  p_escalation_id uuid, p_to_profile_id uuid, p_reason text, p_outstanding_action text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_esc public.escalations;
  v_handover public.escalation_handovers;
  v_critical boolean;
begin
  select * into v_esc from public.escalations where id = p_escalation_id for update;
  if not found or v_uid is null
     or not (
       (v_esc.assigned_doctor_id = v_uid and private.is_clinical_tier(v_esc.organisation_id))
       or private.is_active_cmo(v_esc.organisation_id)
     ) then
    raise exception 'Only the doctor this case is assigned to, or the Chief Medical Officer, can hand it over.' using errcode = '42501';
  end if;
  if v_esc.status in ('resolved', 'referred') then
    raise exception 'This case is closed; it cannot be handed over.' using errcode = '23514';
  end if;
  if v_esc.assigned_doctor_id is null then
    raise exception 'This case has no doctor yet. Assign it instead of handing it over.' using errcode = '23514';
  end if;
  if p_to_profile_id is null or p_to_profile_id = v_esc.assigned_doctor_id then
    raise exception 'Choose a different doctor to hand this case to.' using errcode = '23514';
  end if;
  if p_to_profile_id = v_esc.patient_id or not exists (
    select 1 from public.clinical_staff cs
     where cs.profile_id = p_to_profile_id and cs.organisation_id = v_esc.organisation_id and cs.active
       and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer')
  ) then
    raise exception 'A case can only be handed to an active doctor in this organisation.' using errcode = '23514';
  end if;
  if private.clinician_on_leave(p_to_profile_id) then
    raise exception 'That doctor is on leave. Choose someone who is working.' using errcode = '23514';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Say why you are handing this case over (at least 10 characters).' using errcode = '23514';
  end if;
  if length(btrim(coalesce(p_outstanding_action, ''))) < 10 then
    raise exception 'Say what still needs doing on this case (at least 10 characters).' using errcode = '23514';
  end if;
  if exists (select 1 from public.escalation_handovers where escalation_id = v_esc.id and status = 'pending') then
    raise exception 'This case already has a handover waiting for an answer. Cancel it first to choose someone else.' using errcode = '23505';
  end if;

  v_critical := private.escalation_is_critical(v_esc);

  insert into public.escalation_handovers (
    organisation_id, escalation_id, patient_id, from_profile_id, to_profile_id, requested_by,
    reason, outstanding_action, is_critical, acknowledge_by
  )
  values (
    v_esc.organisation_id, v_esc.id, v_esc.patient_id, v_esc.assigned_doctor_id, p_to_profile_id, v_uid,
    btrim(p_reason), btrim(p_outstanding_action), v_critical,
    now() + case when v_critical then interval '15 minutes' else interval '60 minutes' end
  )
  returning * into v_handover;

  perform private.notify_escalation_handover(v_handover, 'escalation_handover_offered', array[p_to_profile_id]);
  return v_handover.id;
end;
$function$;

-- 4. Answer ----------------------------------------------------------------------------------------------------------------------
-- Returns the handover's status after the call: 'accepted', 'declined', or 'superseded' when the case closed or changed hands while
-- the handover was waiting (then nothing moves, and the caller is told so rather than given an error).
create or replace function public.respond_escalation_handover(p_handover_id uuid, p_accept boolean, p_decline_reason text default null)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_handover public.escalation_handovers;
  v_esc public.escalations;
begin
  select * into v_handover from public.escalation_handovers where id = p_handover_id for update;
  if not found or v_uid is null or v_handover.to_profile_id <> v_uid then
    raise exception 'Only the doctor this case is being handed to can answer the handover.' using errcode = '42501';
  end if;
  if v_handover.status = 'superseded' then
    -- The case closed or changed hands while this waited (private.supersede_escalation_handovers); nothing moves.
    return 'superseded';
  end if;
  if v_handover.status <> 'pending' then
    raise exception 'This handover has already been answered or cancelled.' using errcode = '23514';
  end if;
  if p_accept is null then
    raise exception 'Choose accept or decline.' using errcode = '23514';
  end if;

  select * into v_esc from public.escalations where id = v_handover.escalation_id for update;
  if v_esc.status in ('resolved', 'referred') or v_esc.assigned_doctor_id is distinct from v_handover.from_profile_id then
    update public.escalation_handovers set status = 'superseded', responded_at = now() where id = v_handover.id;
    return 'superseded';
  end if;

  if p_accept then
    if not exists (
      select 1 from public.clinical_staff cs
       where cs.profile_id = v_uid and cs.organisation_id = v_esc.organisation_id and cs.active
         and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer')
    ) then
      raise exception 'Only an active doctor can take this case.' using errcode = '42501';
    end if;
    -- Mark the handover first, so the supersede trigger below finds nothing waiting when the case changes hands.
    update public.escalation_handovers set status = 'accepted', responded_at = now(), responded_by = v_uid
     where id = v_handover.id returning * into v_handover;
    update public.escalations set assigned_doctor_id = v_uid where id = v_esc.id;
    perform private.notify_escalation_handover(v_handover, 'escalation_handover_accepted',
                                               array[v_handover.from_profile_id, v_handover.requested_by]);
    return 'accepted';
  end if;

  if length(btrim(coalesce(p_decline_reason, ''))) < 10 then
    raise exception 'Say why you are declining (at least 10 characters).' using errcode = '23514';
  end if;
  update public.escalation_handovers
     set status = 'declined', responded_at = now(), responded_by = v_uid, decline_reason = btrim(p_decline_reason)
   where id = v_handover.id returning * into v_handover;
  perform private.notify_escalation_handover(v_handover, 'escalation_handover_declined',
                                             array[v_handover.from_profile_id, v_handover.requested_by]);
  return 'declined';
end;
$function$;

-- 5. Withdraw --------------------------------------------------------------------------------------------------------------------
create or replace function public.cancel_escalation_handover(p_handover_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_handover public.escalation_handovers;
begin
  select * into v_handover from public.escalation_handovers where id = p_handover_id for update;
  if not found or v_uid is null
     or not (v_uid in (v_handover.from_profile_id, v_handover.requested_by) or private.is_active_cmo(v_handover.organisation_id)) then
    raise exception 'Only the doctor handing the case over, whoever asked, or the Chief Medical Officer can cancel this handover.' using errcode = '42501';
  end if;
  if v_handover.status <> 'pending' then
    raise exception 'This handover has already been answered, cancelled, or no longer applies.' using errcode = '23514';
  end if;
  update public.escalation_handovers set status = 'cancelled', responded_at = now(), responded_by = v_uid
   where id = v_handover.id returning * into v_handover;
  perform private.notify_escalation_handover(v_handover, 'escalation_handover_cancelled',
                                             array[v_handover.to_profile_id, v_handover.from_profile_id, v_handover.requested_by]);
end;
$function$;

-- 6. A waiting handover stops applying when the case closes or changes hands another way ---------------------------------------
create or replace function private.supersede_escalation_handovers()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_handover public.escalation_handovers;
begin
  if (new.status in ('resolved', 'referred') and old.status is distinct from new.status)
     or new.assigned_doctor_id is distinct from old.assigned_doctor_id then
    for v_handover in
      update public.escalation_handovers
         set status = 'superseded', responded_at = now(), responded_by = (select auth.uid())
       where escalation_id = new.id and status = 'pending'
      returning *
    loop
      -- The new doctor was told a case was offered; tell them it no longer needs an answer.
      perform private.notify_escalation_handover(v_handover, 'escalation_handover_superseded', array[v_handover.to_profile_id]);
    end loop;
  end if;
  return null;
end;
$function$;

revoke all on function private.supersede_escalation_handovers() from public, anon, authenticated;

create trigger escalations_supersede_handovers
  after update of status, assigned_doctor_id on public.escalations
  for each row execute function private.supersede_escalation_handovers();

-- 7. Reads -----------------------------------------------------------------------------------------------------------------------
create or replace function public.escalation_handovers_for(p_escalation_id uuid)
returns table (
  id uuid, status text, from_profile_id uuid, from_name text, to_profile_id uuid, to_name text,
  requested_by uuid, requested_by_name text, reason text, outstanding_action text, is_critical boolean,
  requested_at timestamptz, acknowledge_by timestamptz, responded_at timestamptz, responded_by_name text, decline_reason text
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_esc public.escalations;
begin
  select * into v_esc from public.escalations e where e.id = p_escalation_id;
  if not found or (select auth.uid()) is null or (select auth.uid()) = v_esc.patient_id
     or not private.is_org_staff(v_esc.organisation_id) then
    raise exception 'You cannot see the handovers on this case.' using errcode = '42501';
  end if;
  return query
    select h.id, h.status, h.from_profile_id, pf.full_name, h.to_profile_id, pt.full_name,
           h.requested_by, pr.full_name, h.reason, h.outstanding_action, h.is_critical,
           h.requested_at, h.acknowledge_by, h.responded_at, pa.full_name, h.decline_reason
      from public.escalation_handovers h
      left join public.profiles pf on pf.id = h.from_profile_id
      left join public.profiles pt on pt.id = h.to_profile_id
      left join public.profiles pr on pr.id = h.requested_by
      left join public.profiles pa on pa.id = h.responded_by
     where h.escalation_id = p_escalation_id
     order by h.requested_at desc;
end;
$function$;

-- The caller's waiting handovers (to them, from them, or asked by them); a CMO sees every waiting handover in their organisation.
create or replace function public.open_escalation_handovers()
returns table (
  id uuid, escalation_id uuid, patient_name text, patient_number text, patient_is_test boolean,
  from_profile_id uuid, from_name text, to_profile_id uuid, to_name text, requested_by_name text,
  reason text, outstanding_action text, is_critical boolean, requested_at timestamptz, acknowledge_by timestamptz
)
language sql
stable
security definer
set search_path to ''
as $function$
  select h.id, h.escalation_id, pp.full_name, pp.patient_number, coalesce(pp.is_test, false),
         h.from_profile_id, pf.full_name, h.to_profile_id, pt.full_name, pr.full_name,
         h.reason, h.outstanding_action, h.is_critical, h.requested_at, h.acknowledge_by
    from public.escalation_handovers h
    left join public.profiles pp on pp.id = h.patient_id
    left join public.profiles pf on pf.id = h.from_profile_id
    left join public.profiles pt on pt.id = h.to_profile_id
    left join public.profiles pr on pr.id = h.requested_by
   where h.status = 'pending'
     and (select auth.uid()) is not null
     and private.is_org_staff(h.organisation_id)
     and ((select auth.uid()) in (h.to_profile_id, h.from_profile_id, h.requested_by) or private.is_active_cmo(h.organisation_id))
   order by h.acknowledge_by;
$function$;

revoke all on function public.request_escalation_handover(uuid, uuid, text, text) from public, anon;
revoke all on function public.respond_escalation_handover(uuid, boolean, text) from public, anon;
revoke all on function public.cancel_escalation_handover(uuid) from public, anon;
revoke all on function public.escalation_handovers_for(uuid) from public, anon;
revoke all on function public.open_escalation_handovers() from public, anon;
grant execute on function public.request_escalation_handover(uuid, uuid, text, text) to authenticated;
grant execute on function public.respond_escalation_handover(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_escalation_handover(uuid) to authenticated;
grant execute on function public.escalation_handovers_for(uuid) to authenticated;
grant execute on function public.open_escalation_handovers() to authenticated;

-- 8. Registries every patient table must be in (CI's s39d proof) -------------------------------------------------------------
-- No staff_read_scope row: the table has no read policy at all; reads go only through the two read functions above.
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
values ('escalation_handovers', 'patient_id', 'clinical_record', 'review', true, false,
        'G10 (DW-16..19): each handover of an escalation between doctors, with reason, outstanding action and answer. Same class as escalations. Class assigned by the migration author, not yet reviewed by the CMO and DPO.')
on conflict (table_name) do nothing;

select private.rebuild_analytics_clean_views();

-- 9. Self-check -----------------------------------------------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('authenticated', 'public.escalation_handovers', 'SELECT')
     or has_table_privilege('authenticated', 'public.escalation_handovers', 'INSERT')
     or has_table_privilege('authenticated', 'public.escalation_handovers', 'UPDATE')
     or has_table_privilege('anon', 'public.escalation_handovers', 'SELECT') then
    raise exception 'G10 self-check: escalation_handovers is directly reachable';
  end if;
  if has_function_privilege('anon', 'public.request_escalation_handover(uuid, uuid, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.respond_escalation_handover(uuid, boolean, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cancel_escalation_handover(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.escalation_handovers_for(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.open_escalation_handovers()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.notify_escalation_handover(public.escalation_handovers, text, uuid[])', 'EXECUTE') then
    raise exception 'G10 self-check: a handover function is executable by the wrong role';
  end if;
  if not exists (select 1 from public.data_registry where table_name = 'escalation_handovers') then
    raise exception 'G10 self-check: escalation_handovers is not in data_registry';
  end if;
end $$;
