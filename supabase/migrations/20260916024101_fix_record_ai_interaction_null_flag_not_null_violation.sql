-- Fix: public.record_ai_interaction() computed flagged_for_review with SQL
-- three-valued logic instead of a boolean, so most routine calls raised a
-- silent 23502 not-null violation instead of ever writing an audit row.
--
-- v_flag := array_length(p_output_flags, 1) is not null
--           or p_safety_classification in ('urgent_escalation', 'emergency')
--           or p_status = 'blocked';
--
-- p_safety_classification defaults to NULL and almost no call site passes
-- one. `NULL in (...)` is NULL, not false, so whenever output_flags is
-- empty, safety_classification is NULL and status isn't 'blocked' -- the
-- overwhelmingly common case -- `false or NULL or false` is NULL, not
-- false, and that NULL was inserted straight into flagged_for_review,
-- which is `not null`. apps/web/src/lib/ai-governance/audit.ts's
-- recordAiInteraction() deliberately swallows this error (an audit write
-- failing must not take down the patient-facing call it is recording), so
-- the failure was invisible: the AI feature kept working, its own
-- audit-trail row just never got written. Confirmed live 2026-09-16 for
-- AI-010 (bp_control_assessment) and AI-004 (clinician_alert_case_brief),
-- both of which never pass p_safety_classification -- a spot-check of
-- ai_interaction_log showed only a handful of rows across recent days
-- despite far more AI interactions having actually happened.
--
-- Bug present since the function was first created
-- (20260829094322_ai_governance_interaction_audit_and_incidents.sql) and
-- unchanged through its one subsequent create-or-replace
-- (20260829101733_ai_governance_runtime_coverage_and_actor_check.sql) --
-- roughly 18 days of silent audit-trail loss for any call with no explicit
-- safety_classification. See docs/AI_GOVERNANCE_SPEC.md for the note on
-- this gap window.
--
-- Fix: make every branch of v_flag boolean-safe with coalesce so the
-- expression can never itself be NULL. Function body is otherwise
-- identical to the live definition in the migration above.

create or replace function public.record_ai_interaction(
  p_system_code           text,
  p_model_identifier      text,
  p_input_category        text,
  p_status                public.ai_interaction_status,
  p_subject_profile_id    uuid    default null,
  p_output_summary        text    default null,
  p_safety_classification public.alert_level default null,
  p_guardrails_triggered  text[]  default '{}'::text[],
  p_output_flags          public.ai_output_flag[] default '{}'::public.ai_output_flag[],
  p_prompt_version_id     uuid    default null,
  p_knowledge_source_ids  uuid[]  default '{}'::uuid[],
  p_resulting_action      text    default null,
  p_resulting_entity_type text    default null,
  p_resulting_entity_id   uuid    default null,
  p_fallback_reason       text    default null,
  p_latency_ms            integer default null,
  p_input_token_count     integer default null,
  p_output_token_count    integer default null,
  p_error_message         text    default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_system  record;
  v_org     uuid;
  v_actor   uuid := (select auth.uid());
  v_version uuid;
  v_id      uuid;
  v_flag    boolean;
begin
  select s.id, s.clinically_meaningful into v_system
  from public.ai_systems s where s.system_code = p_system_code;

  if v_system.id is null then
    raise exception 'unknown AI system code % -- register it in ai_systems before calling it', p_system_code;
  end if;

  select organisation_id into v_org from public.profiles
  where id = coalesce(p_subject_profile_id, v_actor);

  if v_org is null then
    raise exception 'could not derive an organisation for this AI interaction';
  end if;

  -- You may log an interaction about yourself, or about a patient you are
  -- staff for. A null actor means the service-role key, which bypasses RLS
  -- everywhere else on the platform too -- background jobs and webhooks are
  -- legitimate writers here. Written out rather than left to fall through
  -- NULL comparison, which is what it did before.
  if v_actor is null then
    null;
  elsif coalesce(p_subject_profile_id, v_actor) <> v_actor and not private.is_org_staff(v_org) then
    raise exception 'not authorised: cannot record an AI interaction about another organisation''s patient';
  end if;

  select v.id into v_version
  from public.ai_system_versions v
  where v.ai_system_id = v_system.id
    and v.approved_at is not null
    and v.retired_at is null
  order by v.deployed_at desc nulls last, v.approved_at desc
  limit 1;

  -- Each branch is wrapped in its own coalesce so a NULL safety
  -- classification (the default, and what almost every call site passes)
  -- or a NULL output-flags test can never make the whole expression NULL --
  -- that NULL going into a `not null` column is exactly what broke this.
  v_flag := coalesce(array_length(p_output_flags, 1) is not null, false)
            or coalesce(p_safety_classification in ('urgent_escalation', 'emergency'), false)
            or coalesce(p_status = 'blocked', false);

  insert into public.ai_interaction_log (
    organisation_id, ai_system_id, ai_system_version_id, prompt_version_id,
    model_identifier, subject_profile_id, actor_profile_id, input_category,
    output_summary, safety_classification, status, guardrails_triggered,
    output_flags, flagged_for_review, resulting_action, resulting_entity_type,
    resulting_entity_id, fallback_used, fallback_reason, latency_ms,
    input_token_count, output_token_count, error_message
  ) values (
    v_org, v_system.id, v_version, p_prompt_version_id,
    p_model_identifier, p_subject_profile_id, v_actor, p_input_category,
    left(p_output_summary, 4000), p_safety_classification, p_status, coalesce(p_guardrails_triggered, '{}'),
    coalesce(p_output_flags, '{}'), v_flag, p_resulting_action, p_resulting_entity_type,
    p_resulting_entity_id, p_status = 'fallback',
    case when p_status = 'fallback' then coalesce(p_fallback_reason, 'unspecified') else p_fallback_reason end,
    p_latency_ms, p_input_token_count, p_output_token_count, p_error_message
  )
  returning id into v_id;

  if p_knowledge_source_ids is not null and array_length(p_knowledge_source_ids, 1) is not null then
    insert into public.ai_interaction_sources (interaction_id, knowledge_source_id)
    select v_id, sid
    from unnest(p_knowledge_source_ids) as sid
    where exists (select 1 from public.ai_knowledge_sources k where k.id = sid)
    on conflict do nothing;
  end if;

  if p_status <> 'fallback' then
    perform private.record_ai_model_observation(v_system.id, p_model_identifier, v_org);
  end if;

  return v_id;
end;
$$;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'record_ai_interaction';

  if v_def is null then
    raise exception 'public.record_ai_interaction not found after create or replace';
  end if;

  if v_def not like '%coalesce(array_length(p_output_flags, 1) is not null, false)%'
     or v_def not like '%coalesce(p_safety_classification in (''urgent_escalation'', ''emergency''), false)%'
     or v_def not like '%coalesce(p_status = ''blocked'', false)%'
  then
    raise exception 'record_ai_interaction was not updated with the null-safe v_flag computation';
  end if;

  -- Sabotage control: the pre-fix expression (any leg un-coalesced) must
  -- NOT appear verbatim anymore, or this migration silently no-opped.
  if v_def like '%v_flag := array_length(p_output_flags, 1) is not null%'
  then
    raise exception 'record_ai_interaction still contains the pre-fix, non-null-safe v_flag expression';
  end if;
end;
$$;
