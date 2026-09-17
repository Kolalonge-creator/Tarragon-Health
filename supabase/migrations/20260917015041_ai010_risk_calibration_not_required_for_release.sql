-- AI-010 (Clinical risk scoring service) -- "Risk model calibration" suite
-- downgraded from is_required_for_release = true to false, on the founder's explicit
-- Clinical Director decision (2026-09-17), the same pattern already used
-- for AI-003's non-English language-fidelity suite.
--
-- Reasoning: "calibration" here means proving the SCORE2/SCORE2-OP
-- cardiovascular risk equations predict outcomes accurately for a
-- Nigerian population -- the published equations were derived from
-- European cohorts. No real Nigerian-population outcome data exists yet
-- to check that against, so this suite has never had a run
-- (status: not_run) and was blocking AI-010's v1 approval outright.
-- Writing fabricated calibration test cases to force a pass would be
-- exactly the "seed a passing evaluation run" failure the AI governance
-- module exists to prevent -- so this migration does NOT touch the
-- suite's cases or add a run. It only changes the release-gate weighting,
-- leaving the suite active, visible, and still showing not_run in the
-- console as a dated, honest backlog item (per the console's own "this
-- page is a record, not a gate" framing) until real outcome data or an
-- agreed proxy methodology exists to evaluate against.
--
-- The already-passing "Platform AI safety baseline" (AI-010-scoped cases,
-- backed by the 30 real pytest cases in services/ml/tests/) remains
-- required and satisfied -- this migration does not relax equation-
-- correctness coverage, only the population-calibration question.

do $$
declare
  v_suite_id   uuid;
  v_system_id  uuid;
  v_version_id uuid;
begin
  select id into v_system_id from public.ai_systems where system_code = 'AI-010';
  if v_system_id is null then raise exception 'AI-010 is not registered'; end if;

  select id into v_suite_id from public.ai_evaluation_suites
    where name = 'Risk model calibration' and ai_system_id = v_system_id;
  if v_suite_id is null then raise exception 'Risk model calibration suite not found for AI-010'; end if;

  update public.ai_evaluation_suites
  set is_required_for_release = false
  where id = v_suite_id;

  select v.id into v_version_id from public.ai_system_versions v where v.ai_system_id = v_system_id and v.version = 'v1';

  if not (private.ai_release_gate(v_version_id)->>'satisfied')::boolean then
    raise exception 'AI-010 v1 should be release-gate-satisfied after downgrading Risk model calibration, outstanding: %',
      private.ai_release_gate(v_version_id)->'outstanding';
  end if;
end;
$$;
