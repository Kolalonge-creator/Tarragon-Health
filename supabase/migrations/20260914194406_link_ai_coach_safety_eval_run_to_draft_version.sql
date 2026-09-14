-- Backfills ai_evaluation_runs.ai_system_version_id for the one real,
-- already-passing AI-001 safety-eval run (id 0ce87c58-98ac-4f34-b02d-
-- fa0410de79cc, suite "AI-001 Safety & Scope Guardrail Eval", 30/30 pass)
-- that was recorded before the ai_system_versions draft row it actually
-- tested (2026-09-14.1, id a896c72a-9df5-455f-982b-4e786897e41e) existed.
-- private.ai_release_gate() matches a run to a version by this column, so
-- an unlinked run reads as "not_run" against every version -- the gate
-- was unsatisfiable for this suite despite a real passing measurement
-- sitting right next to it.
--
-- This is not re-scoring anything: total_cases/passed_cases/outcome/notes
-- are untouched. It was independently re-confirmed the same session, not
-- just trusted from the earlier note -- scripts/ai-coach-safety-eval.ts
-- was re-run for real (fresh claude-sonnet-5 + claude-haiku-4-5 calls)
-- against the graph.ts/keyword-guardrail.ts fixes this run's own notes
-- describe, and reproduced the identical 30/30 (100%) result. See
-- ai-coach-eval-result.json for the fresh run's full per-case output.
--
-- Deliberately does NOT touch the other four suites required for AI-001's
-- release gate (clinical accuracy, fairness across Nigerian populations,
-- red-team, and the platform-wide safety baseline) -- none of those has
-- ever had a run recorded, for AI-001 or, in the platform-baseline case,
-- for any of the platform's 10 registered AI systems. Building real
-- content for those needs a Clinical Director's / founder's own judgement
-- (a "would a clinician assign this tier" ground truth is not something
-- code can invent) and is out of scope for this migration -- see the
-- accompanying conversation for the recommendation to scope that
-- separately rather than fabricate a passing result for it here.

do $$
declare
  v_run record;
begin
  select id, ai_system_id, ai_system_version_id, suite_id, outcome, total_cases, passed_cases
    into v_run
  from public.ai_evaluation_runs
  where id = '0ce87c58-98ac-4f34-b02d-fa0410de79cc';

  if v_run.id is null then
    raise exception 'expected ai_evaluation_runs row 0ce87c58-98ac-4f34-b02d-fa0410de79cc to exist -- has it been deleted or renumbered?';
  end if;

  if v_run.ai_system_version_id is not null then
    raise exception 'ai_evaluation_runs 0ce87c58-... already has ai_system_version_id % -- this migration is not a no-op replay, check what set it', v_run.ai_system_version_id;
  end if;

  if v_run.suite_id <> 'ca0b6499-09dc-4fe0-b5d3-8c19ac8a677f'
     or v_run.outcome <> 'pass'
     or v_run.total_cases <> 30
     or v_run.passed_cases <> 30 then
    raise exception 'ai_evaluation_runs 0ce87c58-... no longer matches the recorded 30/30 pass this migration assumes (suite=%, outcome=%, total=%, passed=%) -- do not blindly link a run whose content has since changed',
      v_run.suite_id, v_run.outcome, v_run.total_cases, v_run.passed_cases;
  end if;
end $$;

update public.ai_evaluation_runs
   set ai_system_version_id = 'a896c72a-9df5-455f-982b-4e786897e41e',
       notes = notes || E'\n\nBackfilled 2026-09-14: ai_system_version_id was left null because this run predated the ai_system_versions draft row it tested. Independently re-confirmed the same day by re-running scripts/ai-coach-safety-eval.ts fresh against the same fixed code -- identical 30/30 (100%) result -- before linking.'
 where id = '0ce87c58-98ac-4f34-b02d-fa0410de79cc';

do $$
declare
  v_gate jsonb;
  v_this_suite jsonb;
begin
  if (select count(*) from public.ai_evaluation_runs
      where id = '0ce87c58-98ac-4f34-b02d-fa0410de79cc'
        and ai_system_version_id = 'a896c72a-9df5-455f-982b-4e786897e41e') <> 1 then
    raise exception 'the backfill update did not take -- ai_system_version_id was not set';
  end if;

  v_gate := private.ai_release_gate('a896c72a-9df5-455f-982b-4e786897e41e');

  -- The overall gate must NOT read satisfied: four other required suites
  -- for AI-001 (clinical accuracy, fairness, red-team, platform baseline)
  -- still have zero runs. A satisfied gate here would mean this migration
  -- silently manufactured an approval path it has no business granting.
  if coalesce((v_gate->>'satisfied')::boolean, false) then
    raise exception 'ai_release_gate reports satisfied=true after only linking one of five required suites -- this migration must not make approval look ready when four suites have never run';
  end if;

  select o.value into v_this_suite
  from jsonb_array_elements(v_gate->'outstanding') as o(value)
  where o.value->>'suite_id' = 'ca0b6499-09dc-4fe0-b5d3-8c19ac8a677f';

  if v_this_suite is not null then
    raise exception 'AI-001 Safety & Scope Guardrail Eval still shows as outstanding after linking its passing run: %', v_this_suite;
  end if;
end $$;
