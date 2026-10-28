-- GLP-1 readiness protocol, version 2: the two fields version 1 left to the Chief Medical Officer are now filled with wording the CMO reviewed and
-- accepted in chat on 2026-10-28 (proposed from published guidance, shown to the CMO in full before this migration was written):
--   * monitoring.stop_and_review_rule: ten conditions (response at 3 and 6 months, pregnancy, pancreatitis, dehydration/kidney, gallbladder, thyroid
--     signs, allergy, mood, hypoglycaemia on insulin/sulfonylurea, eye symptoms in diabetes). This is the one field signing REQUIRES.
--   * entry.ancestry_specific_lower_bmi_cutoffs: NICE-style, 2.5 BMI points lower (27.5, and 24.5 with a weight-related complication) for Black
--     African, African-Caribbean, South Asian, Chinese, other Asian and Middle Eastern ancestry. Optional in the protocol (null means none adopted).
-- Everything else is copied from version 1 unchanged. Version 1 stays a draft (its content is frozen); a review is of THIS exact text, so v2 needs
-- its own independent clinical review and its own source confirmation before the CMO can sign it. Nothing here signs, reviews, confirms or flips a guard.
-- The cited guidance was written from recall and has NOT been opened: verify_against_source stays true so the CMO must confirm the documents were checked.
-- Counts before (live, 2026-10-28): glp1_readiness_protocol has version 1 only, status draft, no review, no signature. Nothing to convert.

insert into public.clinical_config_versions (config_kind, version, content, sources, verify_against_source, founder_position, founder_position_date, notes)
select
  'glp1_readiness_protocol', 2,
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(v1.content, '{monitoring,stop_and_review_rule}', to_jsonb($t$Review with the prescriber, and stop if not resolved, when any of these applies:
1. Response: less than 5% of starting body weight lost after 3 months on the maintenance dose = review; still less than 5% after 6 months = stop.
2. Pregnancy, planned pregnancy, or breastfeeding: stop.
3. Severe or persistent abdominal pain, with or without vomiting (possible pancreatitis): stop and do not restart.
4. Persistent vomiting, diarrhoea or dehydration, or falling kidney function: pause and review.
5. Symptoms of gallbladder disease (pain under the right ribs, fever, jaundice): review.
6. A new lump in the neck, trouble swallowing, or a hoarse voice that does not clear: stop and refer.
7. Severe allergic reaction: stop.
8. New or worsening low mood or thoughts of self-harm: stop and review urgently.
9. A low sugar reading on insulin or a sulfonylurea: review the dose of that medicine.
10. New eye symptoms in a person with diabetes: refer for an eye check.$t$::text)),
        '{monitoring,stop_and_review_rule_note}', to_jsonb('Supplied by the CMO 2026-10-28 (proposed wording accepted in chat); the independent reviewer confirms it against the sources.'::text)),
      '{entry,ancestry_specific_lower_bmi_cutoffs}',
      jsonb_build_object(
        'adjustment', '2.5 BMI points lower than the general lines',
        'groups', jsonb_build_array('Black African', 'African-Caribbean', 'South Asian', 'Chinese', 'other Asian', 'Middle Eastern'),
        'bmi_min', 27.5,
        'bmi_min_with_weight_related_complication', 24.5)),
    '{entry,ancestry_specific_lower_bmi_cutoffs_note}',
    to_jsonb('Supplied by the CMO 2026-10-28: NICE-style adjustment accepted. No cutoff specific to Nigerian or West African populations is universally accepted, so the independent reviewer must confirm this choice.'::text)),
  v1.sources || jsonb_build_array(
    jsonb_build_object('name', 'NICE technology appraisal guidance on semaglutide for managing overweight and obesity (continue only if at least 5% lost at 6 months; lower BMI lines for listed ancestry groups)', 'verification', 'recalled_not_opened'),
    jsonb_build_object('name', 'NICE technology appraisal guidance on tirzepatide for managing overweight and obesity', 'verification', 'recalled_not_opened'),
    jsonb_build_object('name', 'Manufacturer prescribing information for semaglutide and tirzepatide (warnings and stopping advice)', 'verification', 'recalled_not_opened'),
    jsonb_build_object('name', 'WHO expert consultation on BMI in Asian populations (2004): public-health action points 23 and 27.5', 'verification', 'recalled_not_opened')),
  true,
  'CMO-supplied fields 2026-10-28 (stop-and-review rule; ancestry BMI cutoffs); pending independent review of this exact version; not signed',
  date '2026-10-28',
  'Version 2: version 1 plus the two CMO-supplied fields. High risk: needs an approved independent clinical review of this exact version, and the CMO confirming the sources were opened, before signature.'
from public.clinical_config_versions v1
where v1.config_kind = 'glp1_readiness_protocol' and v1.version = 1
on conflict (config_kind, version) do nothing;

do $$
declare v public.clinical_config_versions;
begin
  select * into v from public.clinical_config_versions where config_kind = 'glp1_readiness_protocol' and version = 2;
  if not found then raise exception 'glp1_readiness_protocol version 2 was not inserted'; end if;
  if v.status <> 'draft' or v.approved_by is not null or v.approved_at is not null then raise exception 'version 2 must be an unsigned draft'; end if;
  if not v.verify_against_source then raise exception 'version 2 must still require the CMO to confirm the sources'; end if;
  if length(btrim(v.content #>> '{monitoring,stop_and_review_rule}')) = 0 then raise exception 'the stop-and-review rule must be present'; end if;
  if private.clinical_config_required_unsupplied('glp1_readiness_protocol', v.content) <> array[]::text[] then raise exception 'version 2 must have every CMO-required field supplied'; end if;
  if not private.clinical_config_content_ok('glp1_readiness_protocol', v.content) then raise exception 'version 2 content shape is invalid'; end if;
  if (v.content #>> '{entry,ancestry_specific_lower_bmi_cutoffs,bmi_min}')::numeric <> 27.5 then raise exception 'ancestry cutoff must be 27.5'; end if;
  if exists (select 1 from public.independent_clinical_reviews r where r.config_version_id = v.id) then raise exception 'version 2 must start with no review'; end if;
  if (select status from public.clinical_config_versions where config_kind = 'glp1_readiness_protocol' and version = 1) <> 'draft' then raise exception 'version 1 must be left untouched'; end if;
end $$;
