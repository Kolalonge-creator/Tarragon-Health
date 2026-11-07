-- Support desk review fix (2026-11-07): assigning a help request is not acknowledging the customer.
--
-- private.enforce_navigation_request_update stamped acknowledged_at on ANY staff update of a navigation_requests row,
-- including a change of assigned_to alone. The support desk (SUP-1) reads acknowledged_at as the help request's first
-- response, so a lead bulk-assigning twenty untouched requests made all twenty look answered on target, and moved them
-- out of "New", although the customer had heard nothing. No app code reads acknowledged_at (checked 2026-11-07); it only
-- feeds the desk's view and the support_sla_breach alert.
--
-- Now a staff update stamps acknowledged_at only when it does something the customer can see or that changes the case:
-- status, resolution note, urgency, complaint flag, classification, a linked referral or care-team hand-off. Assignment,
-- and nothing else, leaves it null. Everything else in the function is the LIVE body (read with pg_get_functiondef from
-- koiplnmbgnqnbywhpjlf on 2026-11-07), unchanged.

create or replace function private.enforce_navigation_request_update()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  new.organisation_id := old.organisation_id;
  new.patient_id := old.patient_id;
  new.created_by := old.created_by;

  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    if length(trim(coalesce(new.resolution_note, ''))) = 0 then
      raise exception 'a resolution note is required to resolve a request';
    end if;
    new.resolved_at := now();
    new.resolved_by := v_uid;
  elsif new.status != 'resolved' then
    new.resolved_at := null;
    new.resolved_by := null;
  end if;

  if new.acknowledged_at is null and private.is_org_staff(old.organisation_id)
     and (new.status is distinct from old.status
          or new.resolution_note is distinct from old.resolution_note
          or new.is_urgent is distinct from old.is_urgent
          or new.is_complaint is distinct from old.is_complaint
          or new.classification is distinct from old.classification
          or new.specialist_referral_id is distinct from old.specialist_referral_id
          or new.care_message_thread_id is distinct from old.care_message_thread_id) then
    new.acknowledged_at := now();
  end if;

  if new.classification is distinct from old.classification then
    new.classification_overridden_by := private.timeline_staff_from_profile(v_uid, old.organisation_id);
    new.classification_overridden_at := now();
  end if;

  if new.specialist_referral_id is not null
     and new.specialist_referral_id is distinct from old.specialist_referral_id then
    if not exists (
      select 1 from public.specialist_referrals
      where id = new.specialist_referral_id
        and patient_id = new.patient_id
        and organisation_id = new.organisation_id
    ) then
      raise exception 'referral does not belong to this patient';
    end if;
  end if;

  if new.care_message_thread_id is not null
     and new.care_message_thread_id is distinct from old.care_message_thread_id then
    if not exists (
      select 1 from public.care_message_threads
      where id = new.care_message_thread_id
        and patient_id = new.patient_id
        and organisation_id = new.organisation_id
    ) then
      raise exception 'care message thread does not belong to this patient';
    end if;
  end if;

  if new.satisfaction_rating is distinct from old.satisfaction_rating
     or new.satisfaction_comment is distinct from old.satisfaction_comment then
    if v_uid is distinct from old.patient_id or old.status != 'resolved' then
      raise exception 'feedback can only be left by the patient once the request is resolved';
    end if;
  end if;

  return new;
end;
$function$;
