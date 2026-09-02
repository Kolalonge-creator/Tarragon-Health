-- Tarragon Health — Patient Support & Service Centre, part 5/8: clinical escalation schema.
--
-- §24.7/24.8: support is non-clinical by default, but a "clinical
-- navigation" ticket (or any ticket a support agent realises needs real
-- clinical judgment) must be escalatable into the existing clinical
-- machinery — a clinician_alert, reviewed by an actual clinician, not
-- answered by support staff out of scope. This adds the schema
-- (alert_type_code value + the link column + the authority gate);
-- part 6 adds the escalate_support_ticket_to_clinical() RPC that uses them
-- (its own migration, since a new enum value can't be used in the same
-- transaction that added it).
--
-- private.can_handle_support_escalation() is deliberately a fresh function,
-- not a reuse of private.can_handle_emergency_escalation() or
-- private.has_prescribing_authority() despite tier-list overlap — same
-- "these gate different clinical acts and should be free to diverge"
-- precedent those two set for each other (20260803005216). Flagging a
-- ticket for clinical review is a lower bar than handling an emergency
-- escalation outright, so any clinical tier (not just Tier 2+) may do it —
-- a Care Coordinator may not, since triaging into clinical review is
-- itself a clinical judgment call, not logistics.

alter type public.alert_type_code add value if not exists 'support_ticket_escalation';

alter table public.support_tickets
  add column escalated_alert_id uuid references public.clinician_alerts (id) on delete set null;

comment on column public.support_tickets.escalated_alert_id is
  'Set by escalate_support_ticket_to_clinical() (part 6) when this ticket needed real clinical judgment (§24.7/24.8) — links to the clinician_alert raised for it. Null-gated: a "flagged for clinical review" UI element must check this, not infer it from category.';

create index support_tickets_escalated_alert_idx
  on public.support_tickets (escalated_alert_id) where escalated_alert_id is not null;

create or replace function private.can_handle_support_escalation(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = org
      and active
      and (is_clinical_director or (doctor_tier is not null and doctor_tier <> 'care_coordinator'))
  );
$$;

comment on function private.can_handle_support_escalation(uuid) is
  'Gate for escalating a support ticket into clinical review (§24.7/24.8). Any active clinical-tier staff member (Tier 1 and up) or Clinical Director — a Care Coordinator may not, since deciding a ticket needs clinical judgment is itself a clinical judgment. Deliberately separate from can_handle_emergency_escalation/has_prescribing_authority (different act, same divergence-on-purpose precedent).';

revoke all on function private.can_handle_support_escalation(uuid) from public;
revoke all on function private.can_handle_support_escalation(uuid) from anon;

-- Redefine once more to add the escalation-authority gate: only
-- private.can_handle_support_escalation() may set/clear escalated_alert_id,
-- even though RLS otherwise admits any org-staff UPDATE broadly.
create or replace function private.enforce_support_ticket_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_is_staff boolean;
begin
  if tg_op = 'INSERT' then
    select organisation_id into v_org from public.profiles where id = new.patient_id;
    if v_org is null then
      raise exception 'patient has no organisation on file';
    end if;
    new.organisation_id := v_org;

    if not private.is_org_staff(v_org) and new.patient_id is distinct from v_uid then
      raise exception 'not authorised to file a ticket for this patient' using errcode = '42501';
    end if;

    new.created_by := v_uid;
    new.status := 'new';
    new.assigned_to := null;
    new.assigned_at := null;
    new.first_response_at := null;
    new.escalated_alert_id := null;
    new.resolution_note := null;
    new.resolved_by := null;
    new.resolved_at := null;
    new.closed_by := null;
    new.closed_at := null;
    new.satisfaction_score := null;
    new.satisfaction_comment := null;
    if new.category <> 'technical' then
      new.technical_tier := 1;
    end if;
    return new;
  end if;

  -- UPDATE
  v_org := old.organisation_id;
  v_is_staff := private.is_org_staff(v_org);

  new.organisation_id := old.organisation_id;
  new.patient_id := old.patient_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if not v_is_staff then
    if old.patient_id is distinct from v_uid then
      raise exception 'not authorised' using errcode = '42501';
    end if;

    if new.status is distinct from old.status then
      if not (old.status = 'awaiting_patient' and new.status = 'in_progress') then
        raise exception 'only your care team can change ticket status' using errcode = '42501';
      end if;
    end if;

    if new.category is distinct from old.category
       or new.priority is distinct from old.priority
       or new.channel is distinct from old.channel
       or new.subject is distinct from old.subject
       or new.description is distinct from old.description
       or new.assigned_to is distinct from old.assigned_to
       or new.assigned_at is distinct from old.assigned_at
       or new.technical_tier is distinct from old.technical_tier
       or new.escalated_alert_id is distinct from old.escalated_alert_id
       or new.resolution_note is distinct from old.resolution_note
       or new.resolved_by is distinct from old.resolved_by
       or new.resolved_at is distinct from old.resolved_at
       or new.closed_by is distinct from old.closed_by
       or new.closed_at is distinct from old.closed_at
    then
      raise exception 'only your care team can change ticket routing/status fields' using errcode = '42501';
    end if;

    if new.satisfaction_score is distinct from old.satisfaction_score
       or new.satisfaction_comment is distinct from old.satisfaction_comment then
      if old.status not in ('resolved', 'closed') then
        raise exception 'a satisfaction rating can only be left once the ticket is resolved or closed';
      end if;
      if old.satisfaction_score is not null then
        raise exception 'a satisfaction rating has already been recorded for this ticket';
      end if;
    end if;

    return new;
  end if;

  if new.escalated_alert_id is distinct from old.escalated_alert_id
     and not private.can_handle_support_escalation(v_org) then
    raise exception 'only a clinical-tier member of the care team can escalate a ticket into clinical review' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if new.status in ('resolved', 'closed') and new.resolved_by is null then
      new.resolved_by := v_uid;
      new.resolved_at := coalesce(new.resolved_at, now());
    end if;
    if new.status = 'closed' and new.closed_by is null then
      new.closed_by := v_uid;
      new.closed_at := coalesce(new.closed_at, now());
    end if;
  end if;
  if new.assigned_to is distinct from old.assigned_to and new.assigned_at is not distinct from old.assigned_at then
    new.assigned_at := case when new.assigned_to is not null then now() else null end;
  end if;
  if new.category <> 'technical' then
    new.technical_tier := 1;
  end if;
  new.satisfaction_score := old.satisfaction_score;
  new.satisfaction_comment := old.satisfaction_comment;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'support_tickets' and column_name = 'escalated_alert_id'
  ) then
    raise exception 'support_tickets.escalated_alert_id was not added';
  end if;
  if not exists (select 1 from pg_enum where enumtypid = 'public.alert_type_code'::regtype and enumlabel = 'support_ticket_escalation') then
    raise exception 'alert_type_code.support_ticket_escalation was not added';
  end if;
  if has_function_privilege('anon', 'private.can_handle_support_escalation(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.can_handle_support_escalation';
  end if;
  raise notice 'PASS: support_tickets.escalated_alert_id + can_handle_support_escalation() in place, anon denied';
end $$;
