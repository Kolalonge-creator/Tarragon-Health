-- S07x (decision C5, approved text 2026-10-07, NOT signed): bp_care_triage v4 = v3 with the asymptomatic low blood pressure line (BP-A7) limited to patients taking
-- blood pressure medicines. Amber, 24 hour care-team review, systolic under 90, no symptom, on BP medicines. No guideline sets a home action line for a low reading
-- without symptoms (docs/research/S11-guidelines.md); this is the CMO's own judgement. Option (a) of C5 was chosen over (c) "everyone", which is what v3 does today.
--
-- WHY A NEW VERSION AND NOT AN EDIT: v3 is APPROVED and live (approved 2026-10-07 10:51). A signed rule set is never edited. v4 is a DRAFT. Nothing about live behaviour
-- changes until the Chief Medical Officer approves it with approve_triage_rule_set (which retires v3). An agent never approves it.
--
-- The row is DERIVED in SQL from the stored v3 (not retyped): same rules and parameters, version 4, and rule BP-A7's condition and description replaced.
--
-- THE NEW INPUT. The engine now reads one more fact, `onBpMedicines`. The server context function public.triage_context_for_observation is patched IN PLACE
-- (read with pg_get_functiondef, one entry added to the input object, raises if the anchor moved, idempotent) so that every other change made to it on other branches
-- is kept. The value comes from private.patient_takes_bp_medicines (the S07x programme migration). The phone does not know it and leaves it out; for a phone that only
-- means BP-A7 adds no on-device task, and the server grade (which creates the task) has it.
-- IF v4 IS APPROVED BEFORE THE EDGE FUNCTION IS REDEPLOYED with the engine that reads the field, BP-A7 would never fire (an unknown field is false): the context function
-- below is safe to ship first, the edge function must be redeployed from main-dev before the CMO approves v4 (checklist in docs/design/S07x.md).

-- 1. The draft rule set, derived from v3 ------------------------------------------------------------------------------------------------
insert into public.triage_rule_sets (code, version, status, rules, note)
select s.code, 4, 'draft',
       jsonb_set(
         jsonb_set(s.rules, '{version}', '4'::jsonb),
         '{rules}',
         (select jsonb_agg(
                   case when r.rule ->> 'id' = 'BP-A7' then
                     jsonb_set(
                       jsonb_set(r.rule, '{description}', to_jsonb('Systolic under 90 with no symptom, in a patient taking blood pressure medicines (CMO decision C5)'::text)),
                       '{when}',
                       '{"all":[{"field":"reading.systolic","op":"lt","value":{"ref":"params.low.redSystolic"}},{"field":"onBpMedicines","op":"eq","value":true}]}'::jsonb)
                   else r.rule end
                   order by r.ord)
            from jsonb_array_elements(s.rules -> 'rules') with ordinality as r(rule, ord))),
       'bp_care_triage v4: version 3 with BP-A7 (systolic under 90, no symptom) limited to patients taking blood pressure medicines (decision C5, S07x). DRAFT: the CMO approves it with approve_triage_rule_set; v3 stays in force until then.'
  from public.triage_rule_sets s
 where s.code = 'bp_care_triage' and s.version = 3
on conflict (code, version) do nothing;

-- 2. The server context carries the new fact (patched in place) -------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_anchor constant text := E'\'ageYears\', case when';
  v_new text;
begin
  v_def := pg_get_functiondef('public.triage_context_for_observation(uuid, text, integer)'::regprocedure);
  if v_def like '%onBpMedicines%' then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'public.triage_context_for_observation no longer has the expected ageYears entry; add onBpMedicines by hand' using errcode = '55000';
  end if;
  v_new := replace(v_def, v_anchor, E'\'onBpMedicines\', private.patient_takes_bp_medicines(v.patient_id),\n      \'ageYears\', case when');
  execute v_new;
end $$;

-- 3. Self-check -------------------------------------------------------------------------------------------------------------------------
do $$
declare v3 jsonb; v4 jsonb; v_status text; v_def text;
begin
  select rules into v3 from public.triage_rule_sets where code = 'bp_care_triage' and version = 3;
  select rules, status into v4, v_status from public.triage_rule_sets where code = 'bp_care_triage' and version = 4;
  if v3 is null then raise exception 'S07x self-check: bp_care_triage v3 is missing'; end if;
  if v4 is null then raise exception 'S07x self-check: bp_care_triage v4 was not created'; end if;
  if v_status <> 'draft' then raise exception 'S07x self-check: v4 must be a draft until the CMO approves it, found %', v_status; end if;
  if (select status from public.triage_rule_sets where code = 'bp_care_triage' and version = 3) <> 'approved' then
    raise exception 'S07x self-check: v3 must still be the approved set';
  end if;
  if (v4 -> 'rules') = (v3 -> 'rules') then raise exception 'S07x self-check: v4 rules are identical to v3'; end if;
  if jsonb_array_length(v4 -> 'rules') <> jsonb_array_length(v3 -> 'rules') then raise exception 'S07x self-check: v4 has a different number of rules than v3'; end if;
  if (v4 #- '{rules}' #- '{version}') is distinct from (v3 #- '{rules}' #- '{version}') then raise exception 'S07x self-check: v4 differs from v3 outside its rules and version'; end if;
  if (select count(*) from jsonb_array_elements(v4 -> 'rules') r where r ->> 'id' = 'BP-A7' and r::text like '%onBpMedicines%') <> 1 then
    raise exception 'S07x self-check: BP-A7 was not changed in v4';
  end if;
  if (select count(*) from jsonb_array_elements(v4 -> 'rules') r where r::text like '%onBpMedicines%') <> 1 then
    raise exception 'S07x self-check: v4 changed more than BP-A7';
  end if;
  v_def := pg_get_functiondef('public.triage_context_for_observation(uuid, text, integer)'::regprocedure);
  if v_def not like '%onBpMedicines%' then raise exception 'S07x self-check: the context function does not carry onBpMedicines'; end if;
end $$;
