-- ===========================================================================
-- Fix: an AI interaction with no signed-in person and no subject could not be recorded.
--
-- WHAT WAS WRONG
--   public.record_ai_interaction derives the organisation from the profile of coalesce(p_subject_profile_id, auth.uid()).
--   The Front Desk website chat (AI-023) is used by anonymous visitors through the service-role client: no auth.uid(),
--   no subject profile, so the organisation came back null and the function raised
--   'could not derive an organisation for this AI interaction'. The chat still answered (the audit write is
--   best-effort and logged to console), which means a LIVE governed AI system was answering with no audit row:
--   exactly the gap docs/AI_GOVERNANCE_SPEC.md says the audit trail exists to close. Seen on Vercel at
--   /api/frontdesk/chat (2026-09-07 and again 2026-11-02 11:57 UTC, after AI-023 was switched on).
--
-- FIX
--   When the caller is the service role (auth.uid() is null) AND no subject was named, record the interaction
--   against the platform organisation (Tarragon Health Direct, 00000000-0000-0000-0000-000000000001, the same
--   default the Front Desk tables use). A named subject with no profile still raises: that is a caller bug, not an
--   anonymous visitor. An authenticated caller with no organisation still raises as before.
--
-- Body redefined from the LIVE definition (pg_get_functiondef, 2026-11-02), with only the fallback added.
-- ===========================================================================

create or replace function public.record_ai_interaction(p_system_code text, p_model_identifier text, p_input_category text, p_status public.ai_interaction_status, p_subject_profile_id uuid DEFAULT NULL::uuid, p_output_summary text DEFAULT NULL::text, p_safety_classification public.alert_level DEFAULT NULL::public.alert_level, p_guardrails_triggered text[] DEFAULT '{}'::text[], p_output_flags public.ai_output_flag[] DEFAULT '{}'::public.ai_output_flag[], p_prompt_version_id uuid DEFAULT NULL::uuid, p_knowledge_source_ids uuid[] DEFAULT '{}'::uuid[], p_resulting_action text DEFAULT NULL::text, p_resulting_entity_type text DEFAULT NULL::text, p_resulting_entity_id uuid DEFAULT NULL::uuid, p_fallback_reason text DEFAULT NULL::text, p_latency_ms integer DEFAULT NULL::integer, p_input_token_count integer DEFAULT NULL::integer, p_output_token_count integer DEFAULT NULL::integer, p_error_message text DEFAULT NULL::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
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

  -- An anonymous interaction (service role, no subject named): the website receptionist talking to a visitor who has
  -- no account. It belongs to the platform organisation, so it is audited like every other call.
  if v_org is null and v_actor is null and p_subject_profile_id is null then
    select o.id into v_org from public.organisations o where o.id = '00000000-0000-0000-0000-000000000001';
  end if;

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
$function$;

do $$
begin
  if has_function_privilege('anon', 'public.record_ai_interaction(text,text,text,public.ai_interaction_status,uuid,text,public.alert_level,text[],public.ai_output_flag[],uuid,uuid[],text,text,uuid,text,integer,integer,integer,text)', 'EXECUTE') then
    raise exception 'FAIL: anon holds EXECUTE on public.record_ai_interaction';
  end if;
end $$;
