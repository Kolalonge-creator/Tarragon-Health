-- S80 (S-23, 25.4): phone intake for support tickets and a clinical-ticket close guard.
--
-- Reconciled first. `support_ticket_channel` already has `phone` (the WhatsApp value is gone; the enum is not touched). Tickets are
-- technical-only by CHECK, patients and staff file through the table, and escalate_support_ticket_to_clinical is clinical-tier only.
-- What was missing: (1) a staff door that logs a phone call as a ticket, (2) any rule that a ticket about clinical content cannot
-- be resolved or closed quietly. No job auto-closes tickets today (checked: no cron touches support_tickets); the guard is in the
-- table trigger so no future job or screen can either.
--
--   support_tickets.is_clinical     default false; only staff can set it, it never goes back to false.
--   public.log_phone_support_ticket(phone, subject, description, priority, clinical_content)  staff only. Finds the patient by exact
--       phone in the caller's organisation (one match or it refuses), files channel 'phone'; if the call touched symptoms, medicines
--       or results it also opens a clinician review item (the same shape escalate_support_ticket_to_clinical uses) and links it, so
--       the care team sees it. A non-clinical staff member may log the call; clinicians do the clinical part.
--   private.enforce_support_ticket_write  (create or replace, same signature) now also: stops a patient writing is_clinical,
--       lets only this RPC link an alert to a phone ticket for non-clinical staff, and refuses resolved/closed on a clinical ticket
--       without an outcome note (10+ characters) or while its linked review is unfinished.
-- Counts at write time: existing tickets get is_clinical = false (none were flagged); no data is converted.

alter table public.support_tickets add column is_clinical boolean not null default false;

CREATE OR REPLACE FUNCTION private.enforce_support_ticket_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    new.is_clinical := coalesce(new.is_clinical, false) and private.is_org_staff(v_org);
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
       or new.is_clinical is distinct from old.is_clinical
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
     and not private.can_handle_support_escalation(v_org)
     and not (old.escalated_alert_id is null and old.channel = 'phone'
              and coalesce(current_setting('tarragon.phone_intake_ticket', true), '') = old.id::text) then
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
  -- S-23: a ticket flagged clinical never closes quietly. Once clinical it stays clinical, and it cannot be resolved or closed
  -- without a written outcome note and, when it was routed to clinical review, with that review finished.
  new.is_clinical := old.is_clinical or new.is_clinical;
  if new.status is distinct from old.status and new.status in ('resolved', 'closed') and (new.is_clinical or new.escalated_alert_id is not null) then
    if new.resolution_note is null or char_length(btrim(new.resolution_note)) < 10 then
      raise exception 'a clinical ticket needs a written outcome note (10 characters or more) before it can be resolved or closed' using errcode = '23514';
    end if;
    if new.escalated_alert_id is not null and not exists (
         select 1 from public.clinician_alerts a where a.id = new.escalated_alert_id and a.status in ('resolved', 'closed')) then
      raise exception 'the clinical review for this ticket is not finished, so the ticket cannot be resolved or closed yet' using errcode = '23514';
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
$function$;

create function public.log_phone_support_ticket(
  p_patient_phone text, p_subject text, p_description text,
  p_priority public.support_ticket_priority default 'normal', p_clinical_content boolean default false
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_org     uuid;
  v_n       integer;
  v_patient uuid;
  v_ticket  uuid;
  v_alert   uuid;
  v_phone   text := btrim(coalesce(p_patient_phone, ''));
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = v_uid;
  if v_org is null or not private.is_org_staff(v_org) then
    raise exception 'only staff can log a phone call' using errcode = '42501';
  end if;
  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'enter the caller''s phone number in international form, like +2348012345678' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_subject, ''))) < 3 or char_length(btrim(coalesce(p_description, ''))) < 10 then
    raise exception 'write a subject and a description of at least 10 characters' using errcode = '22023';
  end if;
  select count(*), min(id::text)::uuid into v_n, v_patient from public.profiles where phone = v_phone and organisation_id = v_org and role = 'patient';
  if v_n <> 1 then raise exception 'no single patient matches that phone number' using errcode = '22023'; end if;

  insert into public.support_tickets (organisation_id, patient_id, category, priority, channel, subject, description, is_clinical)
  values (v_org, v_patient, 'technical', p_priority, 'phone', btrim(p_subject), btrim(p_description), coalesce(p_clinical_content, false))
  returning id into v_ticket;

  if coalesce(p_clinical_content, false) then
    insert into public.clinician_alerts (organisation_id, patient_id, level, status, title, detail, sla_due_at, category, type_code)
    values (v_org, v_patient, 'clinician_review', 'open', 'Phone call needs clinical review',
            format('Phone call logged as a support ticket ("%s"): %s', btrim(p_subject), btrim(p_description)),
            now() + interval '24 hours', 'care_management', 'support_ticket_escalation')
    returning id into v_alert;
    perform set_config('tarragon.phone_intake_ticket', v_ticket::text, true);
    update public.support_tickets set escalated_alert_id = v_alert where id = v_ticket;
    perform set_config('tarragon.phone_intake_ticket', '', true);
  end if;

  perform private.log_audit('support.phone_ticket_logged', 'support_tickets', v_ticket, jsonb_build_object('clinical', coalesce(p_clinical_content, false)));
  return v_ticket;
end $$;
revoke all on function public.log_phone_support_ticket(text, text, text, public.support_ticket_priority, boolean) from public, anon;
grant execute on function public.log_phone_support_ticket(text, text, text, public.support_ticket_priority, boolean) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.log_phone_support_ticket(text, text, text, public.support_ticket_priority, boolean)', 'EXECUTE') then
    raise exception 'log_phone_support_ticket is executable by anon';
  end if;
  if exists (select 1 from public.support_tickets where is_clinical) then raise exception 'existing tickets must not be flagged'; end if;
  if (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'support_ticket_channel' and e.enumlabel = 'phone') <> 1 then
    raise exception 'phone channel missing';
  end if;
  if exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'support_ticket_channel' and e.enumlabel = 'whatsapp') then
    raise exception 'whatsapp channel value must stay removed';
  end if;
end $$;
