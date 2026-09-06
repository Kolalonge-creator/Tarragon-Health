-- Tarragon Health — AI Governance: every registered call site now consults
-- the registry, so `is_enabled` is a real kill switch for all ten (40.17).
--
-- 20260829112238 introduced `runtime_governed` precisely because the switch
-- was only real for three systems, and said so on the console rather than
-- letting an operator read "enabled: false" as "stopped". The remaining seven
-- are now wired:
--
--   AI-002  lifestyle nudge proposer — runGovernedAi inside propose(); the
--           fallback is the deterministic templated nudge the engine already
--           sends when no model-drafted message exists.
--   AI-005  lab report extraction — decideAiGovernance + recordAiInteraction
--           around the whole attempt (first pass, corpus lookup, hinted
--           retry), because that control flow does not fit run/fallback. The
--           fallback is the manual entry form, which is what this action
--           already fell back to for every other failure.
--   AI-006  ECG report extraction — same shape as AI-005.
--   AI-007  medication pack recognition — runGovernedAi in pack-actions.ts;
--           the fallback is the patient reading the pack themselves, the path
--           that has always existed and is never removed.
--   AI-008  meal photo nutrition — runGovernedAi in nutrition-actions.ts; the
--           fallback is logging the meal with ai_status = 'unavailable',
--           a state that action already had.
--   AI-009  lifestyle content embeddings — gated inside
--           findRelevantLifestyleContent, so the switch reaches the embedding
--           provider itself and not merely the surfaces that read from it.
--           Successful retrievals are deliberately NOT written to
--           ai_interaction_log: AI-009 is not clinically meaningful, reaches
--           no patient directly, and one row per retrieval would bury the
--           interactions that do matter. A switched-off outcome IS recorded.
--   AI-010  clinical risk scoring — a decorator over MlClient
--           (apps/web/src/lib/ml/governed-ml-client.ts) rather than six
--           call-site edits, which would have been six chances to miss one.
--           MlClient already promises never to throw and to return null on
--           failure, and every caller already degrades on null, so a
--           switched-off system looks exactly like a service that is down —
--           40.18 satisfied by a contract that already existed. health() is
--           passed through ungoverned: it is a liveness probe, and an
--           operator checking reachability while the system is off should get
--           a truthful answer.

update public.ai_systems set runtime_governed = true where not runtime_governed;

do $$
declare
  v_ungoverned text;
begin
  select string_agg(system_code, ', ' order by system_code) into v_ungoverned
  from public.ai_systems where not runtime_governed;

  if v_ungoverned is not null then
    raise exception 'these AI systems still do not consult the registry: %', v_ungoverned;
  end if;

  if (select count(*) from public.ai_systems where runtime_governed) <> 10 then
    raise exception 'expected all 10 registered AI systems to be runtime-governed, found %',
      (select count(*) from public.ai_systems where runtime_governed);
  end if;

  -- The claim this flag makes is only as good as the code behind it, so it is
  -- worth restating where the proof lives: packages/db/tests/ai_governance.sql
  -- exercises the switch end to end, and apps/web/src/lib/ai-governance/
  -- run-governed.test.ts asserts that a thrown switch never reaches the model.
  if not (public.ai_runtime_config('AI-010')->>'runtime_governed')::boolean then
    raise exception 'AI-010 was not marked runtime-governed';
  end if;
end;
$$;
