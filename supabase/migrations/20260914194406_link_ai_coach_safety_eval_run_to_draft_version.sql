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
--
-- 2026-09-15 CI fix (editing this file after it already applied to
-- production is safe -- a migration only ever runs once per environment,
-- tracked by version, so this edit has zero effect on production, which
-- already has both rows below from when this migration first ran there;
-- it only changes what a FRESH replay, e.g. CI's `supabase db reset`,
-- sees): both the ai_system_versions draft row (a896c72a, 2026-09-14.1)
-- and this ai_evaluation_runs row (0ce87c58) were originally created by a
-- prior session's direct SQL tool calls against the live project, never
-- themselves captured in any migration -- an untraced *data* gap, not the
-- untraced-*migration* gap this file's own header describes recovering.
-- On a from-empty CI replay neither row exists yet when this migration
-- runs, so its own assertions below (correctly) failed CI. Recreated here,
-- verbatim from the live values, `on conflict do nothing` so this stays a
-- no-op against production (which already has them) and only backfills a
-- fresh database. See ai_system_versions.created_at below for this row's
-- real original timestamp -- it is out of migration-filename order
-- relative to this file's own version and that is expected: it reflects
-- when the row was actually created, not when this recovery was written.

insert into public.ai_system_versions
  (id, ai_system_id, version, model_identifier, intended_population, excluded_population,
   validation_summary, change_summary, created_at, updated_at)
values
  ('a896c72a-9df5-455f-982b-4e786897e41e'::uuid, 'e518572c-692d-4f1c-ad8f-62194b61a243'::uuid, '2026-09-14.1', 'claude-sonnet-5',
   'Tarragon Health patients with an active app/web account using the AI Coach chat for education, general guidance, and triage support on chronic-disease and preventive-health topics.',
   'Not validated for: diagnosing a condition (explicitly refused by system prompt and confirmed by eval suite AI-001 Safety & Scope Guardrail Eval); prescribing or recommending a specific medication/dose; replacing a doctor visit or care-team judgement; any patient whose date of birth suggests they are a minor (system prompt routes these to extra caution, not full support); emergencies (routed to the deterministic keyword guardrail + LLM tier classification safety net, never treated as the primary channel).',
   'Real, run evaluation evidence -- not an assertion. ai_evaluation_runs id 0ce87c58-98ac-4f34-b02d-fa0410de79cc (suite "AI-001 Safety & Scope Guardrail Eval", id ca0b6499-09dc-4fe0-b5d3-8c19ac8a677f): 30/30 cases passed against the real coach code (scripts/ai-coach-safety-eval.ts) -- 15 deterministic emergency-keyword cases (10 positive across all EMERGENCY_PATTERNS categories + 5 negative controls), 10 scope-guardrail cases (8 adversarial diagnosis/dose/prescribing/replace-doctor probes + 2 helpful-answer controls, graded by a claude-haiku-4-5 judge), 5 referral-tool-discipline cases (explicit vs vague specialist requests, graded on the real tool-call trace). Building this suite found and fixed two real production defects, both now shipped on branch ai-coach/governance-eval-suite: (1) the tool-calling loop in graph.ts pushed a final no-tool-call assistant message onto the request before the structured classify+reply call, which claude-sonnet-5 rejects as unsupported assistant-message prefill -- this silently degraded any turn that used >=1 tool call before finalising its answer to clinician_review with an "I''m having trouble reaching the coach" reply; (2) keyword-guardrail.ts''s emergency regexes required literal adjacent substrings that missed natural patient phrasing for chest pain, suicidal ideation, stroke, and overdose -- widened, with the failing phrasings now permanent regression cases in keyword-guardrail.test.ts. NOT YET REVIEWED OR APPROVED BY A CLINICAL DIRECTOR -- validated_by/approved_by/approved_at are deliberately left null on this row; do not set them from this migration or this session, that sign-off belongs to a human.',
   'Draft -- first ai_system_versions row for AI-001, created after finding no version record existed at all (the governance registry''s "validation" acceptance criterion had nothing behind it). Awaiting Clinical Director review of the linked evaluation run before activation.',
   '2026-09-14T18:16:42.372611Z'::timestamptz, '2026-09-14T18:16:42.372611Z'::timestamptz)
on conflict (id) do nothing;

insert into public.ai_evaluation_runs
  (id, ai_system_id, suite_id, environment, model_identifier, started_at, completed_at,
   total_cases, passed_cases, failed_cases, outcome, notes)
values
  ('0ce87c58-98ac-4f34-b02d-fa0410de79cc'::uuid, 'e518572c-692d-4f1c-ad8f-62194b61a243'::uuid, 'ca0b6499-09dc-4fe0-b5d3-8c19ac8a677f'::uuid,
   'evaluation', 'claude-sonnet-5', '2026-09-14T18:03:28.137Z'::timestamptz, '2026-09-14T18:05:35.761Z'::timestamptz,
   30, 30, 0, 'pass'::public.ai_evaluation_outcome,
   'Real run, not seeded. Two real defects were found and fixed while building this suite (see git history on ai-coach/governance-eval-suite): (1) graph.ts''s tool-calling loop pushed a final no-tool-call assistant response onto the message list before the structured classify+reply call, which claude-sonnet-5 rejects as unsupported assistant-message prefill -- this silently degraded every turn that used >=1 tool call before settling on its answer to clinician_review with an ''I''m having trouble reaching the coach'' reply, in production, until fixed. (2) keyword-guardrail.ts''s emergency-keyword regexes required literal adjacent substrings (''tight in my chest'', ''end my life'', ''slurred speech'', ''too many pills'') that missed natural patient phrasing (''tight, crushing feeling in my chest'', ''ending my life'', ''my speech is slurred'', ''too many of my tablets'') -- widened with bounded gaps, added as permanent regression cases in keyword-guardrail.test.ts. This run''s 30/30 pass rate reflects the coach AFTER both fixes.')
on conflict (id) do nothing;

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
