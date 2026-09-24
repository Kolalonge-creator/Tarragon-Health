-- Fixes a regression in 20260924214612's own status-computation refactor,
-- caught by packages/db/tests/reputation_review_prompts.sql's case 2 before
-- merge: that version only wrote the skip status (skipped_rate_limited or
-- skipped_flag_disabled) to the native_app_store row, leaving no
-- trustpilot_email row at all for a skipped event -- silently changing the
-- admin funnel's skip counts to always read half of what they used to.
-- A skip is a per-patient decision, independent of which channels could
-- have been fulfilled, so both channel rows get the same skip status
-- unconditionally -- only the genuinely 'queued' path (never a skip) is
-- where trustpilot_email's row is conditional on an email existing to send
-- it to.

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
  v_status public.reputation_review_prompt_status;
  v_patient_email text;
  v_trustpilot_prompt_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('reputation_review_prompt:' || p_patient_id::text));

  if not private.is_feature_enabled('reputation_review_prompts', p_patient_id) then
    v_status := 'skipped_flag_disabled';
  elsif exists(
    select 1 from public.reputation_review_prompts
    where patient_id = p_patient_id
      and queued_at > now() - interval '90 days'
      and status not in ('skipped_rate_limited', 'skipped_flag_disabled')
  ) then
    v_status := 'skipped_rate_limited';
  else
    v_status := 'queued';
  end if;

  if v_status <> 'queued' then
    insert into public.reputation_review_prompts
      (organisation_id, patient_id, trigger_event, source_table, source_id, channel, status)
    values
      (p_organisation_id, p_patient_id, p_trigger_event, p_source_table, p_source_id, 'native_app_store', v_status),
      (p_organisation_id, p_patient_id, p_trigger_event, p_source_table, p_source_id, 'trustpilot_email', v_status)
    on conflict (source_table, source_id, channel) do nothing;
    return;
  end if;

  insert into public.reputation_review_prompts
    (organisation_id, patient_id, trigger_event, source_table, source_id, channel, status)
  values
    (p_organisation_id, p_patient_id, p_trigger_event, p_source_table, p_source_id, 'native_app_store', 'queued')
  on conflict (source_table, source_id, channel) do nothing;

  -- No email on file: there's nowhere to send the Trustpilot ask, so don't
  -- create a promise this can't keep -- the native_app_store row above
  -- still stands regardless.
  select email into v_patient_email from auth.users where id = p_patient_id;
  if v_patient_email is null then
    return;
  end if;

  insert into public.reputation_review_prompts
    (organisation_id, patient_id, trigger_event, source_table, source_id, channel, status)
  values
    (p_organisation_id, p_patient_id, p_trigger_event, p_source_table, p_source_id, 'trustpilot_email', 'queued')
  on conflict (source_table, source_id, channel) do nothing
  returning id into v_trustpilot_prompt_id;

  if v_trustpilot_prompt_id is null then
    return; -- already existed (re-fired trigger on the same source row) -- don't email twice
  end if;

  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, payload, content_class, source_table, source_id)
  values
    (p_organisation_id, p_patient_id, 'email', 'pending', 'reputation_review_request_trustpilot',
     jsonb_build_object('to_email', v_patient_email, 'reputation_review_prompt_id', v_trustpilot_prompt_id),
     'non_clinical', 'reputation_review_prompts', v_trustpilot_prompt_id);
end;
$function$;
