-- S85-D1: bp_care_triage v4 = version 3 with the emergency-symptom question asked from 180/120 instead of 200/130.
-- A DRAFT. NOT signed, NOT approved. The Chief Medical Officer has not read or signed it. Do not apply it to production until the build owner says so;
-- applying it only adds a draft row (see "What applying changes" below) and changes nothing a patient sees.
--
-- Founder decision D1 (2026-10-07): a reading of 180/120 or more (either number) asks the emergency-symptom question (today 200/130).
--   * A symptom ticked, including "severe or new headache": RED (BP-R1: emergency guidance, nearest facility, immediate on-call page; the
--     consented Care Circle alert and the follow-up task are the existing actions that follow a red grade).
--   * No symptom: AMBER. Clinician contact the same day (the existing Priority 1 server alert), recheck after 2 hours (BP-X2, the existing recheck
--     reminder and backup push), the amber same-day task (BP-A1) if it is still high at the recheck or never rechecked.
--   * Pregnancy and the 6 weeks after a birth: unchanged. Deterministic only, no model in the path (INV-01).
--
-- Why version 4 and not an edit: version 3 is APPROVED and live (approved 2026-10-07 10:51 UTC); an approved row is immutable, and versions 1 and 2
-- are retired. The row is derived in SQL from the stored version 3 (not retyped): same rules and parameters, with
--   * `version` 4,
--   * `params.extreme` = {"systolic": 180, "diastolic": 120} (every rule already reads the question line through `params.extreme`, so no rule changes),
--   * `params.proposedForCmo`: the three decisions the CMO still has, recorded as PROPOSED and not guessed (see below),
--   * the display text of BP-X1 and BP-X2, which said "200/130".
-- `params.severe` (BP-R1, the red line with a symptom) has been 180/120 since version 1 and does not change. `params.urgent` stays 180/110.
--
-- The CMO still decides (the draft carries the current values, it does not pick for the CMO):
--   1. whether "severe or new headache" is one symptom or two (today one: `severe_headache`);
--   2. whether 180/110, not 180/120, should be the trigger line (today `params.urgent` 180/110 still drives the 5 minute repeat below 180 systolic,
--      and the amber task at the recheck still fires at 180/110 or more, one notch stricter than the founder's "still 180/120");
--   3. the recheck window (today 120 minutes, window 240).
--
-- What applying changes: nothing live. `public.triage_rule_set_for_grading` and `get_approved_triage_rule_set` always prefer the approved version
-- (order by approved first), so while version 3 is approved version 4 is never graded with, never cached on a phone, never shown to a patient.
-- It appears on /clinician/triage-rules as the newest draft for the CMO to read. Approving it (the CMO only, `approve_triage_rule_set`) retires
-- version 3; the older-version guard from S11c does not stop that (4 > 3).
--
-- The legacy server alert path (`private.handle_bp_reading_red_flag` and `handle_symptom_red_flag`, S11g) needs no change: it reads `params.severe`
-- (unchanged) and treats a reading below 200/120 as the Priority 1 alert it already raises from 160/100 (never an emergency record without a symptom).
-- Row count before this migration: 0 (it adds a row, removes none).
begin;

insert into public.triage_rule_sets (code, version, status, rules, note)
select code, 4, 'draft',
       jsonb_set(
         jsonb_set(
           jsonb_set(
             jsonb_set(rules, '{version}', '4'::jsonb),
             '{params,extreme}', '{"systolic": 180, "diastolic": 120}'::jsonb),
           '{params,proposedForCmo}',
           jsonb_build_object(
             'status', 'PROPOSED: the founder decided the 180/120 line; the CMO has not signed it and still decides the three items below',
             'severeHeadacheIsOneSymptom', 'one symptom today (severe_headache); the CMO decides whether ''severe or new headache'' is one symptom or two',
             'urgentLineIs180Over110', 'params.urgent stays 180/110 (the 5 minute recheck band below 180 systolic); the CMO decides whether 180/110 should be the trigger line instead',
             'recheckWindow', 'params.extremeRecheck stays 120 minutes (window 240); the CMO decides the recheck window')),
         '{rules}',
         (select jsonb_agg(
                   case r.rule ->> 'id'
                     when 'BP-X1' then jsonb_set(r.rule, '{description}', to_jsonb('180/120 or more (either number) and the symptom question not yet answered: ask it first (founder decision D1, draft)'::text))
                     when 'BP-X2' then jsonb_set(r.rule, '{description}', to_jsonb('180/120 or more (either number), no emergency symptom: take usual medicine if not taken, rest, recheck after 2 hours (founder decision D1, draft)'::text))
                     else r.rule
                   end
                   order by r.ord)
            from jsonb_array_elements(rules -> 'rules') with ordinality as r(rule, ord))),
       'bp_care_triage v4 DRAFT, founder decision D1 (2026-10-07): the emergency-symptom question from 180/120 (v3: 200/130). Symptom = red; none = amber with a 2 hour recheck. NOT signed by the CMO, who still decides: one headache symptom or two, whether 180/110 should be the trigger, the recheck window. Approve only with approve_triage_rule_set, by the CMO.'
  from public.triage_rule_sets
 where code = 'bp_care_triage' and version = 3
on conflict (code, version) do nothing;

do $$
declare v3 public.triage_rule_sets%rowtype; v4 public.triage_rule_sets%rowtype; j3 jsonb; j4 jsonb;
begin
  select * into v3 from public.triage_rule_sets where code = 'bp_care_triage' and version = 3;
  select * into v4 from public.triage_rule_sets where code = 'bp_care_triage' and version = 4;
  if v3.id is null then raise exception 'S85-D1 self-check: bp_care_triage v3 is missing'; end if;
  if v4.id is null then raise exception 'S85-D1 self-check: bp_care_triage v4 was not created'; end if;
  if v4.status <> 'draft' or v4.approved_by is not null or v4.approved_at is not null then
    raise exception 'S85-D1 self-check: v4 must be an unsigned draft, found % / approved_by %', v4.status, v4.approved_by;
  end if;
  j3 := v3.rules; j4 := v4.rules;
  if (j4 #>> '{params,extreme,systolic}')::int <> 180 or (j4 #>> '{params,extreme,diastolic}')::int <> 120 then
    raise exception 'S85-D1 self-check: v4 extreme line is not 180/120';
  end if;
  if (j3 #>> '{params,extreme,systolic}')::int <> 200 or (j3 #>> '{params,extreme,diastolic}')::int <> 130 then
    raise exception 'S85-D1 self-check: v3 must still say 200/130 (a rule set is never edited)';
  end if;
  if (j4 -> 'code') <> to_jsonb('bp_care_triage'::text) or (j4 -> 'version') <> to_jsonb(4) then
    raise exception 'S85-D1 self-check: the JSON must repeat the row code and version';
  end if;
  if (j4 #>> '{params,severe,systolic}')::int <> 180 or (j4 #>> '{params,severe,diastolic}')::int <> 120
     or (j4 #>> '{params,urgent,systolic}')::int <> 180 or (j4 #>> '{params,urgent,diastolic}')::int <> 110 then
    raise exception 'S85-D1 self-check: severe must stay 180/120 and urgent 180/110';
  end if;
  if jsonb_array_length(j4 -> 'rules') <> jsonb_array_length(j3 -> 'rules') then raise exception 'S85-D1 self-check: v4 must have the same rules as v3'; end if;
  -- nothing differs except the version, the extreme line, the note for the CMO and the two descriptions
  if (((j4 #- '{params,extreme}') #- '{params,proposedForCmo}') - 'version') #- '{rules}'
       is distinct from (((j3 #- '{params,extreme}') - 'version') #- '{rules}') then
    raise exception 'S85-D1 self-check: v4 differs from v3 outside the version, the extreme line and the note';
  end if;
  if (select jsonb_agg(r - 'description') from jsonb_array_elements(j4 -> 'rules') r)
       is distinct from (select jsonb_agg(r - 'description') from jsonb_array_elements(j3 -> 'rules') r) then
    raise exception 'S85-D1 self-check: a v4 rule differs from v3 in more than its description';
  end if;
  if exists (select 1 from public.triage_rule_sets where code = 'bp_care_triage' and version = 4 and status <> 'draft') then
    raise exception 'S85-D1 self-check: v4 is not a draft';
  end if;
end $$;

commit;
