-- Reputation & Review-Generation Engine
--
-- Triggers a review request at a genuine relief/resolution moment: an
-- escalation or clinician alert resolved, an abnormal lab result explained
-- to the patient, or a chronic-care check-in/programme milestone completed.
-- Never a blanket "rate us" popup, never gated behind a review, never
-- WhatsApp-only. See docs/COMPETITIVE_INSIGHTS_BUILD_PLAN.md category 1.
--
-- Off by default behind the 'reputation_review_prompts' feature flag. The
-- Trustpilot business profile does not exist yet (a founder/ops action) --
-- the founder must create it and set TRUSTPILOT_REVIEW_URL before turning
-- the flag on for real.

create type public.reputation_review_trigger_event as enum (
  'escalation_resolved',
  'clinician_alert_resolved',
  'lab_result_explained',
  'chronic_checkin_completed',
  'chronic_programme_milestone_completed'
);

create type public.reputation_review_channel as enum (
  'native_app_store',
  'trustpilot_email'
);

-- 'sent'/'shown' both mean "we asked" (email dispatched / native API
-- invoked) -- neither the OS nor Trustpilot tells us if a review was
-- actually left, so this table deliberately never claims to track
-- submission, only request -> engagement.
create type public.reputation_review_prompt_status as enum (
  'queued',
  'sent',
  'shown',
  'clicked',
  'dismissed',
  'skipped_rate_limited',
  'skipped_flag_disabled'
);

-- Named "reputation_review_prompts", not a bare "review_prompts": this
-- codebase already has public.care_plan_review_prompts (an unrelated
-- clinician worklist item), and several other *_review* tables.
create table public.reputation_review_prompts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id),
  patient_id uuid not null references public.profiles (id),
  trigger_event public.reputation_review_trigger_event not null,
  source_table text not null,
  source_id uuid not null,
  channel public.reputation_review_channel not null,
  status public.reputation_review_prompt_status not null default 'queued',
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  shown_at timestamptz,
  clicked_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index reputation_review_prompts_source_channel_uniq
  on public.reputation_review_prompts (source_table, source_id, channel);

create index reputation_review_prompts_patient_recent_idx
  on public.reputation_review_prompts (patient_id, queued_at desc);

alter table public.reputation_review_prompts enable row level security;

create policy reputation_review_prompts_select_own
  on public.reputation_review_prompts for select
  using (patient_id = (select auth.uid()) or private.is_analyst());

-- A freshly created table needs its own grant -- RLS restricts rows, it
-- does not grant table-level access. All writes go through the
-- SECURITY DEFINER functions below, so authenticated only needs SELECT.
grant select on public.reputation_review_prompts to authenticated;

-- Enqueues one prompt per channel for a trigger event, gated by the
-- feature flag and a cross-trigger 90-day cooldown per patient. The
-- cooldown check (not per-trigger-type, per-patient) is also what stops a
-- double-ask when e.g. an escalation and its underlying alert both resolve
-- the same day -- whichever fires the trigger function second sees the
-- first's row and skips.
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
    -- Recorded, not silently dropped -- a skipped ask should be visible in
    -- the admin funnel, not indistinguishable from "nothing happened".
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

  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, payload, content_class, source_table, source_id)
  select
    p_organisation_id,
    p_patient_id,
    'email',
    'pending',
    'reputation_review_request_trustpilot',
    '{}'::jsonb,
    'non_clinical',
    'reputation_review_prompts',
    rrp.id
  from public.reputation_review_prompts rrp
  where rrp.source_table = p_source_table
    and rrp.source_id = p_source_id
    and rrp.channel = 'trustpilot_email';
end;
$function$;

-- This function accepts an arbitrary patient_id, so a logged-in patient
-- must never call it directly (spoofing/spam risk) -- only the trigger
-- functions below call it, and they run SECURITY DEFINER as the function
-- owner, which always has implicit execute on its own functions regardless
-- of grants. `private` schema functions default to authenticated-executable
-- in this codebase; this is a deliberate, explicit exception.
revoke all on function private.enqueue_reputation_review_prompt(
  uuid, uuid, public.reputation_review_trigger_event, text, uuid
) from public, authenticated;

create or replace function private.reputation_review_on_escalation_resolved()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    perform private.enqueue_reputation_review_prompt(
      new.organisation_id, new.patient_id, 'escalation_resolved', 'escalations', new.id
    );
  end if;
  return new;
end;
$function$;

create trigger escalations_enqueue_review_prompt
  after update on public.escalations
  for each row execute function private.reputation_review_on_escalation_resolved();

create or replace function private.reputation_review_on_clinician_alert_resolved()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then
    perform private.enqueue_reputation_review_prompt(
      new.organisation_id, new.patient_id, 'clinician_alert_resolved', 'clinician_alerts', new.id
    );
  end if;
  return new;
end;
$function$;

create trigger clinician_alerts_enqueue_review_prompt
  after update on public.clinician_alerts
  for each row execute function private.reputation_review_on_clinician_alert_resolved();

-- "Explained", not merely "readable in the dashboard": patient_informed_at
-- is only stamped once a clinician confirms the patient was actually told,
-- per the same distinction the 20260829122500 migration documents.
create or replace function private.reputation_review_on_lab_result_explained()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.patient_informed_at is not null and old.patient_informed_at is null then
    perform private.enqueue_reputation_review_prompt(
      new.organisation_id, new.patient_id, 'lab_result_explained', 'screening_results', new.id
    );
  end if;
  return new;
end;
$function$;

create trigger screening_results_enqueue_review_prompt
  after update on public.screening_results
  for each row execute function private.reputation_review_on_lab_result_explained();

create or replace function private.reputation_review_on_chronic_occurrence_completed()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_event public.reputation_review_trigger_event;
begin
  if new.status = 'completed' and old.status is distinct from 'completed'
     and new.occurrence_type in ('doctor_checkin', 'programme_end_review') then
    v_event := case new.occurrence_type
      when 'doctor_checkin' then 'chronic_checkin_completed'
      else 'chronic_programme_milestone_completed'
    end;
    perform private.enqueue_reputation_review_prompt(
      new.organisation_id, new.patient_id, v_event,
      'chronic_programme_schedule_occurrences', new.id
    );
  end if;
  return new;
end;
$function$;

create trigger chronic_programme_occurrences_enqueue_review_prompt
  after update on public.chronic_programme_schedule_occurrences
  for each row execute function private.reputation_review_on_chronic_occurrence_completed();

-- Mobile calls this on session start. "shown" means the app invoked the
-- native review API -- the OS decides whether to actually display it and
-- never reports back, so this is the honest limit of what's measurable.
create or replace function public.claim_pending_reputation_review_prompt()
returns public.reputation_review_prompts
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row public.reputation_review_prompts;
begin
  select * into v_row
  from public.reputation_review_prompts
  where patient_id = (select auth.uid())
    and channel = 'native_app_store'
    and status = 'queued'
  order by queued_at asc
  limit 1
  for update skip locked;

  if v_row.id is null then
    return null;
  end if;

  update public.reputation_review_prompts
  set status = 'shown', shown_at = now()
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$function$;

-- anon inherits EXECUTE through the PUBLIC pseudo-role, not a direct grant
-- -- revoke from public, not from anon, then grant back to authenticated.
revoke all on function public.claim_pending_reputation_review_prompt() from public;
grant execute on function public.claim_pending_reputation_review_prompt() to authenticated;

create or replace function public.record_reputation_review_prompt_outcome(p_id uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if p_outcome not in ('clicked', 'dismissed') then
    raise exception 'invalid reputation review prompt outcome: %', p_outcome;
  end if;

  update public.reputation_review_prompts
  set
    status = p_outcome::public.reputation_review_prompt_status,
    clicked_at = case when p_outcome = 'clicked' then now() else clicked_at end,
    dismissed_at = case when p_outcome = 'dismissed' then now() else dismissed_at end
  where id = p_id
    and patient_id = (select auth.uid())
    and status in ('queued', 'sent', 'shown');
end;
$function$;

revoke all on function public.record_reputation_review_prompt_outcome(uuid, text) from public;
grant execute on function public.record_reputation_review_prompt_outcome(uuid, text) to authenticated;

-- Off by default. Category 'growth' does not match
-- private.reject_clinical_safety_flag()'s blocklist, so it's a legitimate
-- admin-rollout-able flag, unlike anything abnormal-result/emergency-related.
insert into public.feature_flags (key, label, description, category, status, rollout_percent)
values (
  'reputation_review_prompts',
  'Reputation review prompts',
  'Triggers a native app-store review request and a Trustpilot email ask '
  || 'after a genuine relief/resolution moment (an escalation or clinician '
  || 'alert resolved, an abnormal lab result explained to the patient, or a '
  || 'chronic-care check-in/programme milestone completed). Off by default; '
  || 'the founder must also set TRUSTPILOT_REVIEW_URL before turning this '
  || 'on for real, since the Trustpilot business profile does not exist yet.',
  'growth',
  'off',
  0
)
on conflict (key) do nothing;

-- New patient-controlled opt-out category for the Trustpilot email, matching
-- every other non-critical notification's opt-out convention. Not used
-- anywhere else in this migration/transaction, so safe alongside its own
-- ADD VALUE (a value used in the same transaction it's added in is refused).
alter type public.notification_preference_category add value if not exists 'reputation_requests';
