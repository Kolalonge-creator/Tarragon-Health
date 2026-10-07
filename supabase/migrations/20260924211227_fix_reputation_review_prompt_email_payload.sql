-- Fix found while wiring up the email template: send-pending-notifications'
-- email channel has no automatic profiles.email fallback (there is no
-- profiles.email column at all) -- every other email-enqueueing trigger in
-- this codebase resolves auth.users.email and puts it in payload.to_email
-- itself (see e.g. 20260720120004_prescription_lab_order_patient_emails.sql).
-- The first cut of enqueue_reputation_review_prompt inserted an empty
-- payload, which would have failed every send with "recipient has no email
-- address" -- caught before the edge function template was even wired up.

create or replace function private.enqueue_reputation_review_prompt(
  p_organisation_id uuid,
  p_patient_id uuid,
  p_trigger_event public.reputation_review_trigger_event,
  p_source_table text,
  p_source_id uuid
) returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_recent_count int;
  v_patient_email text;
begin
  if not private.is_feature_enabled('reputation_review_prompts', p_patient_id) then
    return;
  end if;

  select count(*) into v_recent_count
  from public.reputation_review_prompts
  where patient_id = p_patient_id
    and queued_at > now() - interval '90 days'
    and status not in ('skipped_rate_limited', 'skipped_flag_disabled');

  if v_recent_count > 0 then
    insert into public.reputation_review_prompts
      (organisation_id, patient_id, trigger_event, source_table, source_id, channel, status)
    values
      (p_organisation_id, p_patient_id, p_trigger_event, p_source_table, p_source_id, 'native_app_store', 'skipped_rate_limited'),
      (p_organisation_id, p_patient_id, p_trigger_event, p_source_table, p_source_id, 'trustpilot_email', 'skipped_rate_limited')
    on conflict (source_table, source_id, channel) do nothing;
    return;
  end if;

  insert into public.reputation_review_prompts
    (organisation_id, patient_id, trigger_event, source_table, source_id, channel, status)
  values
    (p_organisation_id, p_patient_id, p_trigger_event, p_source_table, p_source_id, 'native_app_store', 'queued'),
    (p_organisation_id, p_patient_id, p_trigger_event, p_source_table, p_source_id, 'trustpilot_email', 'queued')
  on conflict (source_table, source_id, channel) do nothing;

  select email into v_patient_email from auth.users where id = p_patient_id;

  -- No email on file: the native_app_store prompt above still stands, but
  -- there's nowhere to send the Trustpilot ask -- leave that row `queued`
  -- rather than silently failing it through the edge function.
  if v_patient_email is not null then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload, content_class, source_table, source_id)
    select
      p_organisation_id,
      p_patient_id,
      'email',
      'pending',
      'reputation_review_request_trustpilot',
      jsonb_build_object('to_email', v_patient_email),
      'non_clinical',
      'reputation_review_prompts',
      rrp.id
    from public.reputation_review_prompts rrp
    where rrp.source_table = p_source_table
      and rrp.source_id = p_source_id
      and rrp.channel = 'trustpilot_email';
  end if;
end;
$function$;
