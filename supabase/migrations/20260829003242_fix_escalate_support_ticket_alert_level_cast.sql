-- Fix: the CASE expression's branches were bare text literals, which
-- Postgres resolved to `text` rather than implicitly casting to
-- public.alert_level inside an INSERT ... VALUES list, so the very first
-- live invocation of escalate_support_ticket_to_clinical() (caught by
-- packages/db/tests/support_centre.sql case 14, before this ever reached a
-- commit) failed with "column level is of type alert_level but expression
-- is of type text". Cast the CASE result explicitly. The original
-- migration file (20260829002308) was edited in place to already contain
-- this fix — see this repo's own precedent
-- (20260828204545_fix_snooze_trigger_skip_follow_up_task_when_reason_null)
-- for the same "fix applied live as its own migration, source file edited
-- in place so a fresh reset is already correct" pattern.

create or replace function public.escalate_support_ticket_to_clinical(
  p_ticket_id uuid,
  p_note text
)
returns public.support_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.support_tickets;
  v_alert_id uuid;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if v_ticket.id is null then
    raise exception 'ticket not found';
  end if;
  if not private.can_handle_support_escalation(v_ticket.organisation_id) then
    raise exception 'only a clinical-tier member of the care team can escalate a ticket into clinical review' using errcode = '42501';
  end if;
  if v_ticket.escalated_alert_id is not null then
    raise exception 'this ticket has already been escalated into clinical review';
  end if;
  if p_note is null or length(btrim(p_note)) = 0 then
    raise exception 'escalating a ticket into clinical review needs a note explaining why';
  end if;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, sla_due_at, category, type_code)
  values (
    v_ticket.organisation_id,
    v_ticket.patient_id,
    case when v_ticket.priority = 'critical' then 'urgent_escalation' else 'clinician_review' end::public.alert_level,
    'open',
    'Support ticket needs clinical review',
    format('Ticket "%s" (%s): %s', v_ticket.subject, v_ticket.category::text, p_note),
    now() + interval '24 hours',
    'care_management',
    'support_ticket_escalation'
  )
  returning id into v_alert_id;

  update public.support_tickets
    set escalated_alert_id = v_alert_id
    where id = p_ticket_id
    returning * into v_ticket;

  return v_ticket;
end;
$$;

do $$
begin
  raise notice 'PASS: escalate_support_ticket_to_clinical() level cast fixed';
end $$;
