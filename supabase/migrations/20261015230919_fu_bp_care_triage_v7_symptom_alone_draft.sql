-- Follow-up OQ-355: bp_care_triage v7 = version 6 plus rules for a symptom reported with NO blood pressure reading. A DRAFT. NOT signed, NOT approved.
-- The Chief Medical Officer has not read or signed it; an agent never signs a rule set. Applying this migration only adds a draft row.
--
-- Why: the engine grades readings. A symptom alone (chest pain, weakness, a convulsion in pregnancy) had no rule, so the live danger-sign path
-- (handle_symptom_red_flag, untouched here) is the only thing that can page for it, and the shadow bridge from P6 only records what that path decided.
-- Version 7 gives the engine its own, signed-by-the-CMO answer for that case:
--   BP-S1 red   chest pain, weakness or numbness, difficulty speaking: emergency guidance and an immediate on-call page.
--   BP-S3 red   in pregnancy or the first 6 weeks after a birth, a convulsion or loss of consciousness (what BP-P6 grades beside a reading).
--   BP-S2 amber any other red-flag symptom: emergency guidance and the urgent review task due in 240 minutes, one a week per patient.
-- Everything PROPOSED is for the CMO to change (params.proposedForCmo.symptomAlone names the three decisions).
--
-- Built from the STORED version 6 row (derived, not retyped): same rules and parameters, with `version` 7, the new group
-- params.symptomGroups.symptomAloneEmergency, the note, and the three rules appended. Only the `symptom` trigger can reach the new rules, and no
-- code sends that trigger to the engine yet, so nothing changes for any patient: wiring the bridge to grade with the approved version is a follow-up that
-- starts only after the CMO signs. Signing version 7 also signs the 180/120 line of founder decision D1 (carried unchanged from version 6) and retires
-- the approved version 3; version 6 stays a draft if the CMO would rather sign without the symptom rules.
-- Row count before this migration: 0 rows for version 7 (it adds a row, removes none).
insert into public.triage_rule_sets (code, version, status, rules, note)
select code, 7, 'draft',
       jsonb_set(
         jsonb_set(
           jsonb_set(
             jsonb_set(rules, '{version}', '7'::jsonb),
             '{params,symptomGroups,symptomAloneEmergency}', '["chest_pain", "weakness_or_numbness", "difficulty_speaking"]'::jsonb),
           '{params,proposedForCmo}',
           (rules #> '{params,proposedForCmo}') || jsonb_build_object(
             'symptomAlone', 'Version 7 adds three rules for a symptom reported with no reading (BP-S1, BP-S2, BP-S3). The CMO decides which symptoms page at once (params.symptomGroups.symptomAloneEmergency: chest pain, weakness or numbness, difficulty speaking), whether the other red-flag symptoms should be a same-day review (amber) or also page, and the 4 hour due time. Not covered by these rules, so the live danger-sign path still decides them: a convulsion or loss of consciousness outside pregnancy, epigastric pain, and pre-eclampsia symptoms in pregnancy beyond the amber review.')),
         '{rules}',
         (rules -> 'rules') || $json$
[
  {
    "id": "BP-S1",
    "description": "A symptom with no reading: chest pain, weakness or numbness, or difficulty speaking is an emergency",
    "triggers": ["symptom"],
    "result": "grade",
    "grade": "red",
    "explanationKey": "EMG-001",
    "when": { "symptomGroup": "symptomAloneEmergency" },
    "actions": [{ "kind": "show_emergency_guidance", "code": "EMG-001" }, { "kind": "page_on_call" }]
  },
  {
    "id": "BP-S3",
    "description": "A symptom with no reading, in pregnancy or the first 6 weeks after birth: a convulsion or loss of consciousness is an emergency",
    "triggers": ["symptom"],
    "result": "grade",
    "grade": "red",
    "explanationKey": "EMG-001",
    "when": { "all": [{ "field": "obstetric", "op": "eq", "value": true }, { "symptomGroup": "obstetricEmergency" }] },
    "actions": [{ "kind": "show_emergency_guidance", "code": "EMG-001" }, { "kind": "page_on_call" }]
  },
  {
    "id": "BP-S2",
    "description": "A symptom with no reading: any other red-flag symptom needs a same-day review",
    "triggers": ["symptom"],
    "result": "grade",
    "grade": "amber",
    "explanationKey": "TRI-002",
    "when": { "symptomGroup": "redFlag" },
    "actions": [
      { "kind": "show_emergency_guidance", "code": "EMG-001" },
      { "kind": "create_task", "task": "urgent_bp_review", "dueMinutes": 240, "notifyKey": "notify.triage.task_created" }
    ],
    "taskAnchor": "week"
  }
]
$json$::jsonb),
       'bp_care_triage v7 DRAFT (follow-up OQ-355): version 6 plus BP-S1, BP-S3 (red) and BP-S2 (amber) for a symptom reported with no reading. NOT signed by the CMO, who decides which symptoms page at once and the due time. Approve only with approve_triage_rule_set, by the CMO.'
  from public.triage_rule_sets
 where code = 'bp_care_triage' and version = 6
on conflict (code, version) do nothing;

do $$
declare v6 public.triage_rule_sets%rowtype; v7 public.triage_rule_sets%rowtype;
begin
  select * into v6 from public.triage_rule_sets where code = 'bp_care_triage' and version = 6;
  select * into v7 from public.triage_rule_sets where code = 'bp_care_triage' and version = 7;
  if v6.id is null then raise exception 'OQ-355 self-check: bp_care_triage v6 is missing'; end if;
  if v7.id is null then raise exception 'OQ-355 self-check: bp_care_triage v7 was not created'; end if;
  if v7.status <> 'draft' or v7.approved_by is not null or v7.approved_at is not null then
    raise exception 'OQ-355 self-check: v7 must be an unsigned draft, found % / approved_by %', v7.status, v7.approved_by;
  end if;
  if (v7.rules -> 'version') <> to_jsonb(7) or (v7.rules -> 'code') <> to_jsonb('bp_care_triage'::text) then
    raise exception 'OQ-355 self-check: the JSON must repeat the row code and version';
  end if;
  if jsonb_array_length(v7.rules -> 'rules') <> jsonb_array_length(v6.rules -> 'rules') + 3 then
    raise exception 'OQ-355 self-check: v7 must have exactly three more rules than v6';
  end if;
  if (select jsonb_agg(r) from jsonb_array_elements(v7.rules -> 'rules') with ordinality x(r, o) where o <= jsonb_array_length(v6.rules -> 'rules'))
       is distinct from (v6.rules -> 'rules') then
    raise exception 'OQ-355 self-check: the first rules of v7 must be v6 unchanged';
  end if;
  if (((v7.rules #- '{params,symptomGroups,symptomAloneEmergency}') #- '{params,proposedForCmo}') - 'version') #- '{rules}'
       is distinct from (((v6.rules #- '{params,proposedForCmo}') - 'version') #- '{rules}') then
    raise exception 'OQ-355 self-check: v7 differs from v6 outside the version, the new group, the note and the rules';
  end if;
  -- approval is done live by the CMO, never by a migration: one approved version on the live project, none on a fresh replay
  if (select count(*) from public.triage_rule_sets where code = 'bp_care_triage' and status in ('approved')) > 1 then
    raise exception 'OQ-355 self-check: at most one bp_care_triage version may be approved';
  end if;
end $$;
