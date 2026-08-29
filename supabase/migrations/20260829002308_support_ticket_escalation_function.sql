-- Tarragon Health — Patient Support & Service Centre, part 6/8: clinical escalation RPC.
--
-- escalate_support_ticket_to_clinical() is the §24.8 "Support interaction ->
-- Potential clinical issue -> Clinical escalation -> Nurse/clinician" flow.
-- Own migration (own transaction) because it uses the alert_type_code value
-- added in part 5 — Postgres won't allow a new enum value to be used in the
-- same transaction that added it.
--
-- Raises a real clinician_alert (same table every other clinical escalation
-- in this codebase uses — never a parallel, second-class alert mechanism)
-- and links it back via support_tickets.escalated_alert_id. Ticket status
-- is left untouched: escalation is additive tracking alongside the
-- ticket's own lifecycle, not a replacement for it. severity/ownership
-- assignment on the alert itself is left to the existing
-- classify_and_assign_clinician_alert trigger, same as every other caller
-- of clinician_alerts.

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

comment on function public.escalate_support_ticket_to_clinical(uuid, text) is
  'The §24.8 clinical-escalation action: raises a real clinician_alert (category=care_management, type_code=support_ticket_escalation) for a ticket that turned out to need clinical judgment, and links it via support_tickets.escalated_alert_id. Gated to private.can_handle_support_escalation(); a note explaining why is required.';

revoke execute on function public.escalate_support_ticket_to_clinical(uuid, text) from public, anon;
grant execute on function public.escalate_support_ticket_to_clinical(uuid, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'escalate_support_ticket_to_clinical'
  ) then
    raise exception 'escalate_support_ticket_to_clinical was not created';
  end if;
  if has_function_privilege('anon', 'public.escalate_support_ticket_to_clinical(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute escalate_support_ticket_to_clinical';
  end if;
  raise notice 'PASS: escalate_support_ticket_to_clinical() in place, anon denied';
end $$;
