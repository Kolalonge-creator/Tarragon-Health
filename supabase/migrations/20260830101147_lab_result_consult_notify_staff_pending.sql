-- Tarragon Health — tell org clinical staff when a lab-result consult
-- request first becomes claimable, so a doctor doesn't have to keep
-- checking /clinician/lab-result-consults manually.
--
-- Precedent check first (2026-08-30 founder follow-up): clinician_alerts is
-- the obvious first guess ("new item, clinician needs to act") but is the
-- WRONG mechanism here — checked its live classify/assign trigger
-- (private.classify_and_assign_clinician_alert) and it drives a real
-- clinical-severity/SLA/escalation-ladder/auto-assignment system keyed off
-- alert_type_code (abnormal_result, symptom_escalation, deterioration,
-- etc.) with no "routine logistics" bucket — shoehorning "a patient's
-- payment cleared, pick a time" into it would dilute a system whose whole
-- purpose is surfacing genuinely urgent clinical findings, and there is no
-- SLA/escalation timer this kind of item should ever have. The support-inbox
-- (20260712010514) and care_outreach_engine queues were also checked and
-- have NO active staff-facing push at all — staff just check the page.
-- notification_broadcasts (20260716200000) is the one real "broadcast"
-- mechanism in this codebase, but it's a manual, admin-triggered,
-- patient/partner-audience announcement tool, not an automatic
-- staff-audience one. Conclusion: no existing "auto-notify all org staff of
-- a routine queue item" mechanism exists to reuse, so this builds the
-- minimal correct one — one notifications row per active, non-Care-
-- Coordinator clinical_staff member, in_app only (this is routine, not
-- emergency, per the founder's own framing; no whatsapp/sms leg at all, so
-- the guaranteed-in-app-companion rule doesn't apply — there's nothing else
-- to guarantee a companion for).
create or replace function private.notify_org_clinical_staff(
  p_organisation_id uuid,
  p_template text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select p_organisation_id, cs.profile_id, 'in_app', 'pending', p_template, p_payload
  from public.clinical_staff cs
  where cs.organisation_id = p_organisation_id
    and cs.active
    and cs.doctor_tier is not null
    and cs.doctor_tier <> 'care_coordinator'
    and cs.profile_id is not null;
end;
$$;

-- Fires exactly once per request: the moment status first reaches
-- 'payment_confirmed' (the earliest claimable state — document_uploaded
-- always arrives later, via an already-claimable row, so it needs no
-- second notification). Mirrors the WHEN-clause idiom already used
-- elsewhere on this table's sibling systems (e.g.
-- lab_orders_enqueue_lab_notifications: old.status IS DISTINCT FROM
-- new.status AND new.status = 'payment_confirmed').
create or replace function private.notify_new_lab_result_consult_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'payment_confirmed' and old.status is distinct from new.status then
    perform private.notify_org_clinical_staff(
      new.organisation_id,
      'lab_result_consult_request_pending',
      jsonb_build_object('request_id', new.id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists lab_result_consult_requests_notify_staff on public.lab_result_consult_requests;
create trigger lab_result_consult_requests_notify_staff
  after update of status on public.lab_result_consult_requests
  for each row execute function private.notify_new_lab_result_consult_request();

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.lab_result_consult_requests'::regclass
      and tgname = 'lab_result_consult_requests_notify_staff'
  ) then
    raise exception 'FAIL: lab_result_consult_requests_notify_staff trigger was not created';
  end if;
end $$;
