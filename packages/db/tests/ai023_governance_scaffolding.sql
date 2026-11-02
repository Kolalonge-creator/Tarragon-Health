-- Proof: the AI-023 (Website Receptionist) governance scaffolding is structurally complete and the human gate is still closed.
-- BEGIN/ROLLBACK, nothing left behind. Sabotage steps at the end prove the checks discriminate.
begin;

do $$
declare
  v_id   uuid;
  v_out  jsonb;
  v_n    int;
  v_blocked boolean;
begin
  select id into v_id from public.ai_systems where system_code = 'AI-023';
  if v_id is null then raise exception 'FAIL 1: AI-023 not registered'; end if;
  if (select is_enabled from public.ai_systems where id = v_id) then raise exception 'FAIL 2: AI-023 is enabled'; end if;
  -- Check 3 (updated 2026-11-02 by 20261102135233_ai023_runtime_governed): the flag now says the truth. Every receptionist call goes
  -- through runGovernedAi, which consults ai_runtime_config('AI-023') first, so the system IS runtime governed; the original check
  -- guarded against the scaffolding migration claiming that before a call site existed.
  if not (select runtime_governed from public.ai_systems where id = v_id) then raise exception 'FAIL 3: AI-023 should be runtime_governed (the call site consults ai_runtime_config)'; end if;
  if (select vendor_id from public.ai_systems where id = v_id) is null then raise exception 'FAIL 4: AI-023 has no vendor'; end if;

  -- Structural criteria are met; exactly the two human judgements remain.
  v_out := private.ai_acceptance_criteria(v_id)->'outstanding';
  if v_out <> '["evaluation_passing", "validation"]'::jsonb then
    raise exception 'FAIL 5: outstanding criteria are %, expected only evaluation_passing and validation', v_out;
  end if;

  select count(*) into v_n from public.ai_guardrails where ai_system_id = v_id and is_active;
  if v_n <> 8 then raise exception 'FAIL 6: % active guardrails, expected 8', v_n; end if;
  if not exists (select 1 from public.ai_guardrails where ai_system_id = v_id and rule_code = 'emergency_fixed_reply_before_model' and kind = 'emergency_escalation' and enforcement = 'blocking') then
    raise exception 'FAIL 7: the emergency guardrail is missing or not blocking';
  end if;
  if not exists (select 1 from public.ai_guardrails where ai_system_id = v_id and rule_code = 'max_autonomy' and config->>'max_level' = 'assist') then
    raise exception 'FAIL 8: the max_autonomy guardrail is missing or not assist';
  end if;

  -- One draft knowledge source per Front Desk topic, none approved.
  select count(*) into v_n from public.ai_knowledge_sources where ai_system_id = v_id;
  if v_n <> (select count(distinct topic) from public.fd_knowledge) then
    raise exception 'FAIL 9: % knowledge sources, expected one per fd_knowledge topic', v_n;
  end if;

  -- The dedicated suite: 68 model cases + 3 probes, required for release, threshold 95; the baseline pair exists and uses codes the table accepts.
  select count(*) into v_n from public.ai_evaluation_cases c join public.ai_evaluation_suites e on e.id = c.suite_id
    where e.ai_system_id = v_id and e.is_required_for_release and e.pass_threshold_pct = 95.00;
  if v_n <> 71 then raise exception 'FAIL 10: % dedicated cases, expected 71 (68 model-routed + 3 adversarial)', v_n; end if;
  select count(*) into v_n from public.ai_evaluation_cases where case_code like 'ai023\_%';
  if v_n <> 2 then raise exception 'FAIL 11: % baseline cases, expected 2', v_n; end if;
  select count(*) into v_n from public.ai_evaluation_cases c join public.ai_evaluation_suites e on e.id = c.suite_id
    where e.ai_system_id = v_id and c.is_adversarial;
  if v_n <> 3 then raise exception 'FAIL 12: % adversarial cases, expected 3', v_n; end if;

  -- No judgement was seeded.
  if exists (select 1 from public.ai_guardrails where ai_system_id = v_id and approved_at is not null) then raise exception 'FAIL 13: a guardrail is approved'; end if;
  if exists (select 1 from public.ai_knowledge_sources where ai_system_id = v_id and approved_at is not null) then raise exception 'FAIL 14: a knowledge source is approved'; end if;
  if exists (select 1 from public.ai_system_versions where ai_system_id = v_id and approved_at is not null) then raise exception 'FAIL 15: a version is approved'; end if;
  if exists (select 1 from public.ai_evaluation_runs where ai_system_id = v_id) then raise exception 'FAIL 16: an evaluation run exists'; end if;

  -- The gate really is closed: switching it on is refused with criteria outstanding.
  v_blocked := false;
  begin
    update public.ai_systems set is_enabled = true where id = v_id;
  exception when others then v_blocked := true; end;
  if not v_blocked then raise exception 'FAIL 17: AI-023 could be enabled with outstanding criteria'; end if;

  -- Sabotage 1: the guardrail-count check discriminates (drop one rule and the count is no longer 8).
  delete from public.ai_guardrails where ai_system_id = v_id and rule_code = 'no_prescribing_or_dosing';
  select count(*) into v_n from public.ai_guardrails where ai_system_id = v_id and is_active;
  if v_n = 8 then raise exception 'SABOTAGE 1 not detected: deleting a guardrail left the count at 8'; end if;

  -- Check 2: a direct approval of a knowledge source is refused. Two independent mechanisms do this (the approval guard trigger, and the
  -- approved_by/approved_at pairing check), so disabling either alone still passes; it fails only if a path opens that stamps both.
  v_blocked := false;
  begin
    update public.ai_knowledge_sources set approved_at = now() where ai_system_id = v_id;
  exception when others then v_blocked := true; end;
  if not v_blocked then raise exception 'FAIL 18: a knowledge source could be approved directly'; end if;

  raise notice 'AI-023 governance scaffolding: all checks PASSED';
end $$;

rollback;
