-- S67 (module 16, pregnancy), the blood pressure rule set: bp_care_triage v5 = v4 plus the two pregnancy changes of CMO item A2.
--
-- WHY VERSION 5. Version 4 belongs to S07x (decision C5: the asymptomatic low blood pressure line BP-A7 limited to patients on blood pressure medicines) and is on main-dev.
-- This branch first made its own version 4 (v3 plus the pregnancy changes). Two different rule sets cannot share a version number, and the second insert would have
-- been skipped silently by `on conflict do nothing`, so the pregnancy rules would have been lost. Instead v5 is DERIVED here from the stored v4 (the way S07x derived
-- v4 from v3), so it carries C5 and the pregnancy changes and nothing else. v4 is not touched.
--
-- NOTHING IS SIGNED. The row is a DRAFT; the CMO approves it with approve_triage_rule_set, which an agent never does. Approving v5 retires whatever is approved
-- before it. v3 stays in force until then.
--
-- The two changes, both from the CMO selections of 2026-10-07 (docs/plans/S66-S70-cmo-signoff-pack.md, item A2):
--   1. `preeclampsiaFlag` gains sudden_face_hand_swelling.
--   2. A new group `obstetricEmergency` (convulsion, loss_of_consciousness) and a new rule BP-P6, placed just before BP-P3: in pregnancy or the first weeks after
--      a birth, either symptom is RED and pages the on-call clinician, whatever the reading.
-- packages/clinical/src/rules/bp-care-v5.ts is the same object; a Jest test compares the two.
begin;

do $$
begin
  if not exists (select 1 from public.triage_rule_sets where code = 'bp_care_triage' and version = 4) then
    raise exception 'S67: bp_care_triage v4 (S07x, decision C5) must exist before v5 is derived from it';
  end if;
end $$;

insert into public.triage_rule_sets (code, version, status, rules, note)
select s.code, 5, 'draft',
       jsonb_set(
         jsonb_set(
           jsonb_set(
             jsonb_set(s.rules, '{version}', '5'::jsonb),
             '{params,symptomGroups,preeclampsiaFlag}',
             (s.rules #> '{params,symptomGroups,preeclampsiaFlag}') || '"sudden_face_hand_swelling"'::jsonb),
           '{params,symptomGroups,obstetricEmergency}',
           '["convulsion","loss_of_consciousness"]'::jsonb),
         '{rules}',
         (select jsonb_agg(x.rule order by x.ord)
            from (
              select r.rule, r.ord * 2 as ord
                from jsonb_array_elements(s.rules -> 'rules') with ordinality as r(rule, ord)
              union all
              select $p6${"id": "BP-P6", "description": "Pregnancy or first 6 weeks after birth: a convulsion or loss of consciousness is an emergency, whatever the reading", "triggers": ["observation"], "result": "grade", "grade": "red", "explanationKey": "EMG-001", "when": {"all": [{"field": "obstetric", "op": "eq", "value": true}, {"symptomGroup": "obstetricEmergency"}]}, "actions": [{"kind": "show_emergency_guidance", "code": "EMG-001"}, {"kind": "page_on_call"}]}$p6$::jsonb,
                     (select r.ord * 2 - 1 from jsonb_array_elements(s.rules -> 'rules') with ordinality as r(rule, ord) where r.rule ->> 'id' = 'BP-P3')
            ) x)),
       'bp_care_triage v5 (S67): v4 (decision C5) plus the pre-eclampsia swelling sign and rule BP-P6 (convulsion or loss of consciousness in pregnancy). DRAFT, PROPOSED; the CMO signs it in the hub.'
  from public.triage_rule_sets s
 where s.code = 'bp_care_triage' and s.version = 4
on conflict (code, version) do nothing;

do $$
declare v5 jsonb; v4 jsonb;
begin
  select rules into v5 from public.triage_rule_sets where code = 'bp_care_triage' and version = 5;
  select rules into v4 from public.triage_rule_sets where code = 'bp_care_triage' and version = 4;
  if v5 is null or (select status from public.triage_rule_sets where code = 'bp_care_triage' and version = 5) <> 'draft' then
    raise exception 'S67 self-check: bp_care_triage v5 must exist as a draft';
  end if;
  if not (v5 -> 'rules' @> '[{"id":"BP-P6"}]'::jsonb) then raise exception 'S67 self-check: v5 must carry rule BP-P6'; end if;
  if jsonb_array_length(v5 -> 'rules') <> jsonb_array_length(v4 -> 'rules') + 1 then raise exception 'S67 self-check: v5 must have exactly one more rule than v4'; end if;
  if (select rule from jsonb_array_elements(v5 -> 'rules') r(rule) where rule ->> 'id' = 'BP-A7') is distinct from (select rule from jsonb_array_elements(v4 -> 'rules') r(rule) where rule ->> 'id' = 'BP-A7') then
    raise exception 'S67 self-check: v5 must keep v4''s BP-A7 (decision C5) exactly';
  end if;
  if exists (select 1 from public.triage_rule_sets where code = 'bp_care_triage' and version = 5 and (approved_by is not null or approved_at is not null)) then
    raise exception 'S67 self-check: v5 must not be approved by this migration';
  end if;
end $$;

commit;
