-- Proof: S23b leaves AI-017's governance structurally complete and the human gate still closed.
-- BEGIN/ROLLBACK, nothing left behind.
begin;

do $$
declare
  v_id   uuid;
  v_out  jsonb;
  v_n    int;
  v_blocked boolean := false;
begin
  select id into v_id from public.ai_systems where system_code = 'AI-017';
  if v_id is null then raise exception 'FAIL 1: AI-017 not registered'; end if;

  if (select is_enabled from public.ai_systems where id = v_id) then raise exception 'FAIL 2: AI-017 is enabled'; end if;
  if (select runtime_governed from public.ai_systems where id = v_id) then raise exception 'FAIL 3: AI-017 is runtime_governed'; end if;

  -- Structural criteria are met; exactly the two human judgements remain.
  v_out := private.ai_acceptance_criteria(v_id)->'outstanding';
  if v_out <> '["evaluation_passing", "validation"]'::jsonb then
    raise exception 'FAIL 4: outstanding criteria are %, expected only evaluation_passing and validation', v_out;
  end if;

  select count(*) into v_n from public.ai_guardrails where ai_system_id = v_id and is_active;
  if v_n <> 7 then raise exception 'FAIL 5: % active guardrails, expected 7', v_n; end if;
  if not exists (select 1 from public.ai_guardrails where ai_system_id = v_id and rule_code = 'no_medication_names_or_doses' and kind = 'prohibited_prescribing' and enforcement = 'blocking') then
    raise exception 'FAIL 6: the INV-02 guardrail is missing or not blocking';
  end if;

  select count(*) into v_n from public.ai_evaluation_cases c join public.ai_evaluation_suites e on e.id = c.suite_id where e.ai_system_id = v_id and e.is_required_for_release;
  -- 6 after the Pidgin case was removed (D-14), plus 6 from S35c (the facts-to-confirm suite, which is also required for release).
  if v_n <> 12 then raise exception 'FAIL 7: % dedicated cases, expected 12 (6 from S23b and S23d, 6 from S35c)', v_n; end if;
  select count(*) into v_n from public.ai_evaluation_cases where case_code like 'ai017\_%';
  if v_n <> 2 then raise exception 'FAIL 8: % baseline cases, expected 2', v_n; end if;

  -- No judgement was seeded.
  if exists (select 1 from public.ai_system_versions where ai_system_id = v_id and approved_at is not null) then raise exception 'FAIL 9: a version is approved'; end if;
  if exists (select 1 from public.ai_evaluation_runs where ai_system_id = v_id) then raise exception 'FAIL 10: an evaluation run exists'; end if;

  -- The gate really is closed: switching it on is refused.
  begin
    update public.ai_systems set is_enabled = true where id = v_id;
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then raise exception 'FAIL 11: AI-017 could be enabled with outstanding criteria'; end if;

  raise notice 'S23b AI-017 governance scaffolding: all checks PASSED';
end $$;

rollback;
