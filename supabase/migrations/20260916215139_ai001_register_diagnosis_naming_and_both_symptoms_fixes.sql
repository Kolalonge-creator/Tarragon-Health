-- AI-001 (AI Health Coach) governance follow-up: registers a new draft
-- ai_system_versions row for COACH_PROMPT_VERSION 2026-09-16.4, covering two
-- real fixes shipped today on top of the 2026-09-16.2 draft already on file:
--
-- (1) PR #639 -- removed the parenthetical diagnostic labels ("possible
-- heart failure decompensation", "possible diabetic emergency") that
-- 2026-09-16.2's emergency-tier expansion had added next to the two new
-- symptom clusters. A real run of "Run evaluations" found the coach echoing
-- these back to patients verbatim in some phrasings ("...a diabetes
-- emergency building up"), a genuine violation of the platform's "never
-- name a diagnosis" rule. The descriptive symptom clusters alone (without
-- the disease-name parenthetical) are what actually drive correct
-- classification -- confirmed by two further real runs with zero
-- diagnosis-naming failures. Bumped COACH_PROMPT_VERSION to 2026-09-16.3.
--
-- (2) PR #641 -- founder decision (Clinical Director): the emergency tier's
-- two chronic-disease-specific symptom-cluster pairs (breathlessness +
-- swelling/weight-gain; thirst-or-urination + fatigue/nausea/vomiting/
-- confusion) must require BOTH parts of their own pair before escalating --
-- a single symptom alone (thirst with nothing else, breathlessness with
-- nothing else) is clinician_review, not emergency. Real evidence: a run of
-- "AI Coach fairness across Nigerian populations" found the coach escalating
-- thirst+urination alone, no other symptom, straight to emergency in 3 of 4
-- phrasings. Verified with two real runs after the fix: fairness suite 4/4
-- both times (was 2/4, then 1/4, across the two runs immediately before).
-- Bumped COACH_PROMPT_VERSION to 2026-09-16.4.
--
-- Neither PR recorded a fresh ai_system_versions draft row for its own
-- change -- both PR bodies say so explicitly and flag it as a follow-up,
-- consistent with this file's job: register that the version exists and
-- summarise the real evidence behind it, never approve it. validated_by/
-- approved_by/approved_at are deliberately left null -- that sign-off
-- belongs to the Clinical Director reviewing this row in the console, not
-- this migration or any session that runs it.

do $$
declare
  v_ai_system_id uuid;
  v_excluded_population text;
  v_validation_summary text;
  v_change_summary text;
begin
  select id into v_ai_system_id from public.ai_systems where system_code = 'AI-001';
  if v_ai_system_id is null then
    raise exception 'AI-001 not found in ai_systems';
  end if;

  if exists (
    select 1 from public.ai_system_versions
    where ai_system_id = v_ai_system_id and version = '2026-09-16.4'
  ) then
    raise exception '2026-09-16.4 draft row already exists for AI-001 -- this migration should only ever run once';
  end if;

  v_excluded_population :=
    'Not validated for: diagnosing a condition (explicitly refused by system prompt and '
    || 'confirmed by eval suite AI-001 Safety & Scope Guardrail Eval -- as of this version the '
    || 'emergency-tier definition itself no longer names a specific disease anywhere in its own '
    || 'text, closing a real leak where the coach echoed a parenthetical diagnostic label back to '
    || 'the patient, see validation_summary); prescribing or recommending a specific medication/'
    || 'dose; replacing a doctor visit or care-team judgement; drug/medication interaction '
    || 'assessment (categorically refused regardless of medication-list access); pattern-matching '
    || 'a symptom presentation outside Tarragon''s own chronic-disease pathways into a familiar '
    || 'diagnostic framework (explicit prompt rule added in COACH_PROMPT_VERSION 2026-09-16.1, see '
    || 'the rare_presentation red-team case); condition-management guidance for a pregnant patient '
    || '(well-established urgent warning signs directly relevant to the topic raised may still be '
    || 'named, framed only as signs to seek care for); any patient whose date of birth suggests '
    || 'they are a minor; emergencies (routed to the deterministic keyword guardrail + LLM tier '
    || 'classification safety net, never treated as the primary channel -- as of this version, '
    || 'each of the two chronic-disease-specific symptom-cluster pairs in the emergency-tier '
    || 'definition requires BOTH parts of its own pair before escalating; one symptom alone from '
    || 'either pair is clinician_review, not emergency, see validation_summary).';

  v_validation_summary :=
    'NOT YET REVIEWED OR APPROVED BY A CLINICAL DIRECTOR -- validated_by/approved_by/'
    || 'approved_at are deliberately left null on this row; that sign-off belongs to a human, not '
    || 'this migration or any session that runs it.'
    || E'\n\n'
    || 'Two real fixes since the 2026-09-16.2 draft, neither of which recorded its own '
    || 'ai_system_versions row at the time (both PR bodies flag this as outstanding):'
    || E'\n\n'
    || '(a) PR #639, COACH_PROMPT_VERSION 2026-09-16.3: removed the parenthetical diagnostic '
    || 'labels ("possible heart failure decompensation", "possible diabetic emergency") that '
    || '2026-09-16.2 had added. A real "Run evaluations" run found the coach echoing these back to '
    || 'patients verbatim in some phrasings ("...a diabetes emergency building up") -- a genuine '
    || 'violation of the never-name-a-diagnosis rule. A first attempt (caveat the labels as '
    || '"internal only") did not fully close it -- one case still leaked "blood sugar emergency". '
    || 'Removed the labels entirely instead; two further real runs on the target clinical-accuracy '
    || 'cases (ankle_swelling_and_breathlessness, fatigue_and_thirst_this_week) passed with zero '
    || 'diagnosis-naming failures.'
    || E'\n\n'
    || '(b) PR #641, COACH_PROMPT_VERSION 2026-09-16.4: founder decision (Clinical Director) that '
    || 'both symptom-cluster pairs require BOTH parts before escalating to emergency -- a single '
    || 'symptom alone is clinician_review. Real evidence: a fairness-suite run found the coach '
    || 'escalating thirst+urination alone (no other symptom) straight to emergency in 3 of 4 '
    || 'phrasings, which the fairness suite correctly read as inconsistent/invented urgency. '
    || 'Reworded thirst/urination from an AND to an OR against its own group, keeping a hard AND '
    || 'against the fatigue/nausea/vomiting/confusion group. A first, stricter draft (literal '
    || '"thirst AND urination AND fatigue") broke fatigue_and_thirst_this_week (thirst + fatigue, '
    || 'no explicit urination) -- caught and corrected before shipping, via a second real run. '
    || 'Verified: AI Coach fairness 4/4 in both post-fix runs (was 2/4, then 1/4, in the two runs '
    || 'immediately before).'
    || E'\n\n'
    || 'Both fixes independently re-verified a third time this session (2026-09-16, after PR #650 '
    || 'changed the fairness suite to grade against the Chief Medical Officer''s own label instead '
    || 'of a second live model call): two fresh full-suite runs from a clean worktree against this '
    || 'exact code, fairness 4/4 both times, red-team 7/7 both times, platform baseline 3/3 both '
    || 'times. Clinical accuracy remains genuinely outstanding, unrelated to either fix in this '
    || 'row: two stable CMO-label-vs-coach disagreements (exertional_chest_tightness, '
    || 'new_medication_afternoon_headache -- the coach more cautious than the label in both '
    || 'directions) and one case that flips between passing and failing run to run '
    || '(fatigue_and_thirst_this_week -- the model reasoning from how mildly the message is '
    || 'worded rather than from the symptoms present, a different and harder problem, deliberately '
    || 'not chased further to avoid reshaping the prompt around one test message). No suite has a '
    || 'passing ai_evaluation_runs row recorded against THIS version id yet -- satisfied stays '
    || 'false until a real "Run evaluations" click records one.';

  v_change_summary :=
    'Draft -- fourth ai_system_versions row for AI-001, covering COACH_PROMPT_VERSION 2026-09-16.3 '
    || 'and 2026-09-16.4 together (neither got its own row when it shipped). (a) 2026-09-16.3 '
    || 'removes the named-diagnosis parenthetical labels 2026-09-16.2 had added to the emergency-'
    || 'tier definition, closing a real diagnosis-naming leak found by a live eval run (PR #639). '
    || '(b) 2026-09-16.4 requires BOTH symptoms of each chronic-disease-specific pair before '
    || 'escalating to emergency, per an explicit founder/Clinical Director decision, closing a real '
    || 'over-triggering-on-one-symptom-alone bug found by the fairness suite (PR #641). See '
    || 'validation_summary for the real run evidence behind each, including a third independent '
    || 'confirmation this session.';

  insert into public.ai_system_versions (
    ai_system_id, version, model_identifier, intended_population, excluded_population,
    validation_summary, change_summary
  )
  values (
    v_ai_system_id,
    '2026-09-16.4',
    'claude-sonnet-5',
    'Tarragon Health patients with an active app/web account using the AI Coach chat for '
    || 'education, general guidance, and triage support on chronic-disease and preventive-health '
    || 'topics.',
    v_excluded_population,
    v_validation_summary,
    v_change_summary
  );
end $$;

do $$
declare
  v_gate jsonb;
  v_version_id uuid;
begin
  select id into v_version_id
  from public.ai_system_versions
  where version = '2026-09-16.4'
    and ai_system_id = (select id from public.ai_systems where system_code = 'AI-001');

  v_gate := private.ai_release_gate(v_version_id);
  if coalesce((v_gate->>'satisfied')::boolean, false) then
    raise exception 'ai_release_gate unexpectedly reports satisfied=true for a version with no recorded runs at all -- this migration should never make a version approvable on its own';
  end if;
end $$;
