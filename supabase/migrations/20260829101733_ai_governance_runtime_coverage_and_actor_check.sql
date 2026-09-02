-- Tarragon Health — AI Governance follow-up: honest runtime coverage, and an
-- explicit service-role check in the audit writer.
--
-- 1. THE KILL SWITCH ONLY WORKS WHERE THE RUNTIME ASKS.
--
--    Part 6 registered all ten running AI capabilities, which is what makes
--    the registry an inventory (40.1). But `is_enabled` is only a kill
--    switch (40.17) for a call site that actually goes through
--    runGovernedAi() and honours the answer. Three do so far -- the AI Coach,
--    the patient result explainer and clinician case briefs. The other seven
--    are registered, classified and guardrailed on the record, but switching
--    one off in the console would not currently stop it running.
--
--    A registry that cannot tell those two states apart is worse than one
--    that admits the difference, because an operator would reasonably read
--    "enabled: false" as "stopped". So `runtime_governed` is a first-class
--    column, it is surfaced by ai_runtime_config() and on the governance
--    dashboard, and the console renders it as a warning rather than a
--    footnote.
--
--    Where each unwired system stands today:
--      AI-002, AI-007, AI-008  helper functions that take neither a Supabase
--                              client nor a subject id, so the governance
--                              seam is at their call sites.
--      AI-005, AI-006          extraction runs inside an action that retries,
--                              so it needs one wrap around the whole attempt
--                              rather than around a single model call.
--      AI-009                  the embedder is constructed synchronously from
--                              env with no request context; it already
--                              degrades to "no retrieval" when unconfigured.
--      AI-010                  ml-client.ts lives in packages/shared and has
--                              no database access by design. It does have a
--                              real off-switch today (an unset ML_SERVICE_URL
--                              makes every call return null and every caller
--                              degrade) -- it is just not the governed one.
--
-- 2. THE SERVICE-ROLE PATH IN record_ai_interaction WAS IMPLICIT.
--
--    Its "you may only log an interaction about yourself or a patient you are
--    staff for" check read `coalesce(p_subject_profile_id, v_actor) <> v_actor`.
--    Under the service-role key auth.uid() is null, so that comparison
--    evaluated to NULL and the guard fell through -- allowing the call, which
--    is the behaviour we want, but by way of three-valued logic rather than
--    by decision. An authorization check that depends on NULL semantics is
--    the kind of thing that changes meaning the next time somebody edits it,
--    so it now says what it means.

alter table public.ai_systems
  add column runtime_governed boolean not null default false;

comment on column public.ai_systems.runtime_governed is
  'True when the running code for this system actually calls public.ai_runtime_config() and honours the answer, i.e. when is_enabled is a real kill switch for it. False means registered and classified but not yet routed: switching it off would not stop it. Never set this true without a call site that goes through runGovernedAi().';

update public.ai_systems
   set runtime_governed = true
 where system_code in ('AI-001', 'AI-003', 'AI-004');

-- Surface it to the runtime and the console.
create or replace function public.ai_runtime_config(p_system_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s        record;
  v_expect text;
begin
  select * into s from public.ai_systems where system_code = p_system_code;

  if s.id is null then
    return jsonb_build_object('registered', false, 'system_code', p_system_code);
  end if;

  select v.model_identifier into v_expect
  from public.ai_system_versions v
  where v.ai_system_id = s.id and v.approved_at is not null and v.retired_at is null
  order by v.deployed_at desc nulls last, v.approved_at desc
  limit 1;

  return jsonb_build_object(
    'registered', true,
    'system_code', s.system_code,
    'system_id', s.id,
    'name', s.name,
    'enabled', s.is_enabled,
    'runtime_governed', s.runtime_governed,
    'lifecycle_status', s.lifecycle_status,
    'risk_class', s.risk_class,
    'autonomy_level', s.autonomy_level,
    'clinically_meaningful', s.clinically_meaningful,
    'fallback_behaviour', s.fallback_behaviour,
    'disabled_reason', s.disabled_reason,
    'expected_model_identifier', v_expect,
    'prompt', private.active_ai_prompt(p_system_code),
    'guardrails', private.ai_guardrails_for(p_system_code),
    'knowledge_sources', private.approved_ai_knowledge_sources(p_system_code)
  );
end;
$$;

comment on function public.ai_runtime_config(text) is
  'Everything the runtime needs about one AI system in a single round trip: kill-switch state, whether the runtime is actually routed through governance, risk and autonomy, fallback behaviour, the governed prompt (null when none is activated -- the caller then uses its in-repo constant), active guardrails, and approved knowledge sources. Distinguishes "not registered" from "registered but disabled": the first is a wiring gap, the second is a deliberate safety decision.';

-- The audit writer's actor check, said explicitly.
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

  v_flag := array_length(p_output_flags, 1) is not null
            or p_safety_classification in ('urgent_escalation', 'emergency')
            or p_status = 'blocked';

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
begin
  if (select count(*) from public.ai_systems where runtime_governed) <> 3 then
    raise exception 'expected exactly the three runtime-wired AI systems, found %',
      (select count(*) from public.ai_systems where runtime_governed);
  end if;

  if not (public.ai_runtime_config('AI-001')->>'runtime_governed')::boolean then
    raise exception 'AI-001 is wired through runGovernedAi but ai_runtime_config does not say so';
  end if;

  if (public.ai_runtime_config('AI-010')->>'runtime_governed')::boolean then
    raise exception 'AI-010 is not wired through runGovernedAi but ai_runtime_config claims it is';
  end if;
end;
$$;
