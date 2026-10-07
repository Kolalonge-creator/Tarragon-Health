-- S59 part 4 of 4 (reworked in S59b, hold item C8): ONE merged DRAFT version: the signed adult pathways (with the chest pain severity floor
-- removed, see 20261007190204), the adult v2 draft pathways (fever, abdominal pain) and the three DRAFT paediatric pathways (fever,
-- dehydration with diarrhoea, breathing in a child). A young infant is under 2 months (the IMCI young infant group), not 3.
--
-- THIS ADDS ONE UNSIGNED, INACTIVE `triage_protocols` ROW and nothing else. No agent signs or activates anything: only the Chief Medical
-- Officer, through public.sign_triage_protocols(), can make it active, and nothing in the patient screen offers a pathway that is not in
-- the ACTIVE signed config. Until then the checker (which is also behind symptom_checker_enabled, OFF) offers the signed adult pathways only.
--
-- The new version carries the currently ACTIVE signed pathways (or version 1 when none is active, as on a fresh local replay) PLUS the
-- three paediatric drafts, so that signing it would not silently drop an adult pathway. The version number is computed when the migration
-- is applied (highest existing plus one), never typed by hand. If the CMO also wants the separate v2 draft (fever and abdominal pain for
-- adults) its pathways must be merged into whichever draft is signed: signing replaces the whole active config (OQ-S59-05).
--
-- The red-flag criteria are a transcription of the widely taught IMCI general danger signs and usual severe-illness signs, in the same
-- class as the signed adult pathways. They are NOT independently clinically reviewed. Every outcome asks a human to look and none is
-- below routine. The JSON below is a copy of packages/symptom-triage-engine/src/protocols/paediatric-drafts.ts; a Jest test fails if
-- the two differ.
--
-- ROWS AFFECTED: one row inserted (idempotent: skipped if a row with this note already exists). No existing row changes.

do $$
declare
  v_version integer;
  v_base jsonb;
  v_paed jsonb;
  v_adult jsonb;
  v_v2_extra jsonb;
  v_config jsonb;
begin
  if exists (select 1 from public.triage_protocols where notes like 'S59 draft:%') then
    return;
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.triage_protocols;
  select coalesce((select config from public.triage_protocols where is_active limit 1),
                  (select config from public.triage_protocols where version = 1)) into v_base;
  if v_base is null then
    raise exception 'S59: no base triage protocol (neither an active one nor version 1) to carry the adult pathways';
  end if;
-- paediatric-draft-begin
  v_paed := $json$[
 {
  "key": "paediatric_fever",
  "label": "Fever in a child",
  "knownAssociatedSymptoms": [
   "convulsions",
   "unable_to_drink_or_feed",
   "vomits_everything",
   "lethargic_or_unconscious",
   "stiff_neck",
   "rash_that_does_not_fade",
   "fast_breathing",
   "chest_indrawing"
  ],
  "knownTriggers": [],
  "knownHistory": [
   "infant_under_2_months",
   "sickle_cell_disease",
   "hiv_or_immunocompromised"
  ],
  "redFlagScreen": [
   {
    "key": "paediatric_fever.general_danger_sign",
    "label": "Fever with a general danger sign",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "convulsions",
      "unable_to_drink_or_feed",
      "vomits_everything",
      "lethargic_or_unconscious"
     ]
    }
   },
   {
    "key": "paediatric_fever.meningeal_signs",
    "label": "Fever with a stiff neck or a rash that does not fade",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "stiff_neck",
      "rash_that_does_not_fade"
     ]
    }
   },
   {
    "key": "paediatric_fever.young_infant",
    "label": "Fever in a very young infant",
    "category": "emergency",
    "rule": {
     "anyHistory": [
      "infant_under_2_months"
     ]
    }
   },
   {
    "key": "paediatric_fever.breathing",
    "label": "Fever with fast breathing or the chest pulling in",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "fast_breathing",
      "chest_indrawing"
     ]
    }
   },
   {
    "key": "paediatric_fever.vulnerable_child",
    "label": "Fever in a child with sickle cell disease or a weakened immune system",
    "category": "urgent",
    "rule": {
     "anyHistory": [
      "sickle_cell_disease",
      "hiv_or_immunocompromised"
     ]
    }
   }
  ],
  "startNodeKey": "duration_check",
  "nodes": {
   "duration_check": {
    "type": "question",
    "kind": "boolean",
    "key": "duration_check",
    "prompt": "Has the fever lasted for more than a couple of days?",
    "onYes": "outcome_urgent_prolonged",
    "onNo": "drinking_check"
   },
   "drinking_check": {
    "type": "question",
    "kind": "boolean",
    "key": "drinking_check",
    "prompt": "Is your child drinking and passing urine as usual?",
    "onYes": "outcome_routine_fever",
    "onNo": "outcome_urgent_not_drinking"
   },
   "outcome_urgent_prolonged": {
    "type": "outcome",
    "key": "outcome_urgent_prolonged",
    "category": "urgent",
    "safetyNetMessageKey": "paediatric_fever.urgent_prolonged",
    "clinicianReviewRequired": true,
    "rationale": "A fever that has lasted for days in a child needs a clinician to look."
   },
   "outcome_urgent_not_drinking": {
    "type": "outcome",
    "key": "outcome_urgent_not_drinking",
    "category": "urgent",
    "safetyNetMessageKey": "paediatric_fever.urgent_not_drinking",
    "clinicianReviewRequired": true,
    "rationale": "Fever with poor drinking or passing less urine in a child needs prompt assessment."
   },
   "outcome_routine_fever": {
    "type": "outcome",
    "key": "outcome_routine_fever",
    "category": "routine",
    "safetyNetMessageKey": "paediatric_fever.routine",
    "clinicianReviewRequired": true,
    "rationale": "Recent fever in a child who is drinking and passing urine as usual: a clinician reviews it, no urgent sign was reported."
   }
  },
  "fallbackOutcome": {
   "type": "outcome",
   "key": "outcome_fallback",
   "category": "urgent",
   "safetyNetMessageKey": "paediatric.fallback",
   "clinicianReviewRequired": true,
   "rationale": "The question graph reached a dead end: treated as needing a clinician to look, never as reassurance."
  }
 },
 {
  "key": "paediatric_dehydration",
  "label": "Diarrhoea or vomiting in a child",
  "knownAssociatedSymptoms": [
   "convulsions",
   "unable_to_drink_or_feed",
   "vomits_everything",
   "lethargic_or_unconscious",
   "sunken_eyes",
   "sunken_soft_spot",
   "no_tears",
   "very_few_wet_nappies",
   "skin_pinch_slow",
   "blood_in_stool"
  ],
  "knownTriggers": [],
  "knownHistory": [
   "infant_under_2_months",
   "sickle_cell_disease"
  ],
  "redFlagScreen": [
   {
    "key": "paediatric_dehydration.general_danger_sign",
    "label": "Diarrhoea or vomiting with a general danger sign",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "convulsions",
      "unable_to_drink_or_feed",
      "vomits_everything",
      "lethargic_or_unconscious"
     ]
    }
   },
   {
    "key": "paediatric_dehydration.young_infant",
    "label": "Diarrhoea or vomiting in a very young infant",
    "category": "emergency",
    "rule": {
     "anyHistory": [
      "infant_under_2_months"
     ]
    }
   },
   {
    "key": "paediatric_dehydration.signs",
    "label": "Signs of dehydration",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "sunken_eyes",
      "sunken_soft_spot",
      "no_tears",
      "very_few_wet_nappies",
      "skin_pinch_slow"
     ]
    }
   },
   {
    "key": "paediatric_dehydration.blood",
    "label": "Blood in the stool",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "blood_in_stool"
     ]
    }
   }
  ],
  "startNodeKey": "drinking_check",
  "nodes": {
   "drinking_check": {
    "type": "question",
    "kind": "boolean",
    "key": "drinking_check",
    "prompt": "Is your child able to drink, and keeping the drink down?",
    "onYes": "duration_check",
    "onNo": "outcome_urgent_not_drinking"
   },
   "duration_check": {
    "type": "question",
    "kind": "boolean",
    "key": "duration_check",
    "prompt": "Has it gone on for more than a day?",
    "onYes": "outcome_urgent_prolonged",
    "onNo": "outcome_routine_dehydration"
   },
   "outcome_urgent_not_drinking": {
    "type": "outcome",
    "key": "outcome_urgent_not_drinking",
    "category": "urgent",
    "safetyNetMessageKey": "paediatric_dehydration.urgent_not_drinking",
    "clinicianReviewRequired": true,
    "rationale": "A child who cannot keep fluids down needs prompt assessment."
   },
   "outcome_urgent_prolonged": {
    "type": "outcome",
    "key": "outcome_urgent_prolonged",
    "category": "urgent",
    "safetyNetMessageKey": "paediatric_dehydration.urgent_prolonged",
    "clinicianReviewRequired": true,
    "rationale": "Diarrhoea or vomiting that has gone on in a child needs a clinician to look."
   },
   "outcome_routine_dehydration": {
    "type": "outcome",
    "key": "outcome_routine_dehydration",
    "category": "routine",
    "safetyNetMessageKey": "paediatric_dehydration.routine",
    "clinicianReviewRequired": true,
    "rationale": "Recent diarrhoea or vomiting in a child who is drinking: a clinician reviews it, no urgent sign was reported."
   }
  },
  "fallbackOutcome": {
   "type": "outcome",
   "key": "outcome_fallback",
   "category": "urgent",
   "safetyNetMessageKey": "paediatric.fallback",
   "clinicianReviewRequired": true,
   "rationale": "The question graph reached a dead end: treated as needing a clinician to look, never as reassurance."
  }
 },
 {
  "key": "paediatric_breathing",
  "label": "Breathing trouble in a child",
  "knownAssociatedSymptoms": [
   "convulsions",
   "unable_to_drink_or_feed",
   "vomits_everything",
   "lethargic_or_unconscious",
   "blue_lips",
   "chest_indrawing",
   "grunting",
   "stridor",
   "fast_breathing",
   "wheeze"
  ],
  "knownTriggers": [
   "choking_or_swallowed_object"
  ],
  "knownHistory": [
   "infant_under_2_months",
   "asthma",
   "sickle_cell_disease"
  ],
  "redFlagScreen": [
   {
    "key": "paediatric_breathing.severe_signs",
    "label": "Blue lips, grunting, the chest pulling in or a harsh noise on breathing in",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "blue_lips",
      "chest_indrawing",
      "grunting",
      "stridor"
     ]
    }
   },
   {
    "key": "paediatric_breathing.general_danger_sign",
    "label": "Breathing trouble with a general danger sign",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "convulsions",
      "unable_to_drink_or_feed",
      "vomits_everything",
      "lethargic_or_unconscious"
     ]
    }
   },
   {
    "key": "paediatric_breathing.choking",
    "label": "Breathing trouble after choking or swallowing something",
    "category": "emergency",
    "rule": {
     "anyTrigger": [
      "choking_or_swallowed_object"
     ]
    }
   },
   {
    "key": "paediatric_breathing.young_infant",
    "label": "Breathing trouble in a very young infant",
    "category": "emergency",
    "rule": {
     "anyHistory": [
      "infant_under_2_months"
     ]
    }
   },
   {
    "key": "paediatric_breathing.fast_or_wheeze",
    "label": "Fast breathing or wheezing",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "fast_breathing",
      "wheeze"
     ]
    }
   }
  ],
  "startNodeKey": "speech_check",
  "nodes": {
   "speech_check": {
    "type": "question",
    "kind": "boolean",
    "key": "speech_check",
    "prompt": "Is your child breathing comfortably when resting?",
    "onYes": "outcome_routine_breathing",
    "onNo": "outcome_urgent_not_comfortable"
   },
   "outcome_urgent_not_comfortable": {
    "type": "outcome",
    "key": "outcome_urgent_not_comfortable",
    "category": "urgent",
    "safetyNetMessageKey": "paediatric_breathing.urgent",
    "clinicianReviewRequired": true,
    "rationale": "A child who is not breathing comfortably at rest needs prompt assessment."
   },
   "outcome_routine_breathing": {
    "type": "outcome",
    "key": "outcome_routine_breathing",
    "category": "routine",
    "safetyNetMessageKey": "paediatric_breathing.routine",
    "clinicianReviewRequired": true,
    "rationale": "Breathing trouble reported, comfortable at rest and no urgent sign reported: a clinician reviews it."
   }
  },
  "fallbackOutcome": {
   "type": "outcome",
   "key": "outcome_fallback",
   "category": "urgent",
   "safetyNetMessageKey": "paediatric.fallback",
   "clinicianReviewRequired": true,
   "rationale": "The question graph reached a dead end: treated as needing a clinician to look, never as reassurance."
  }
 }
]$json$::jsonb;
-- paediatric-draft-end
  -- S59b: (1) the cardiac chest pain pattern loses its severity floor, exactly as in the S59b chest pain draft;
  --       (2) the adult v2 draft's extra pathways (fever, abdominal pain) are carried over so ONE signature covers everything. The v2 row
  --           (version 2, migration 20260911202322) stays as it is, now superseded by this draft; a key already in the base is never duplicated.
  select jsonb_agg(
           case when p ->> 'key' = 'chest_pain' then
             jsonb_set(p, '{redFlagScreen}', (
               select jsonb_agg(case when f ->> 'key' = 'chest_pain.cardiac_pattern' then jsonb_set(f, '{rule}', (f -> 'rule') - 'minSeverity') else f end order by fo)
                 from jsonb_array_elements(p -> 'redFlagScreen') with ordinality as ft(f, fo)))
           else p end
           order by po)
    into v_adult
    from jsonb_array_elements(v_base -> 'pathways') with ordinality as pt(p, po);
  select coalesce(jsonb_agg(p order by po), '[]'::jsonb)
    into v_v2_extra
    from jsonb_array_elements(coalesce((select config -> 'pathways' from public.triage_protocols where version = 2), '[]'::jsonb)) with ordinality as vt(p, po)
   where not exists (select 1 from jsonb_array_elements(v_adult) a where a ->> 'key' = p ->> 'key');
  v_config := jsonb_build_object('version', v_version, 'pathways', v_adult || v_v2_extra || v_paed);
  insert into public.triage_protocols (version, config, notes, is_active)
  values (v_version, v_config,
    'S59 draft: UNSIGNED and INACTIVE. ONE merged draft: the active signed adult pathways (chest pain cardiac pattern with no severity floor), the adult v2 draft pathways (fever, abdominal pain) and three paediatric pathways (fever, dehydration with diarrhoea, breathing). IMCI general danger signs cross-checked against WHO IMCI material, other criteria not independently clinically reviewed (see docs/research/S59b.md). Needs the Chief Medical Officer to review, edit and sign through sign_triage_protocols. Signing replaces the whole active config.',
    false);
end $$;

do $$
begin
  if exists (select 1 from public.triage_protocols where notes like 'S59 draft:%' and (is_active or approved_at is not null or approved_by is not null)) then
    raise exception 'S59 assertion: the paediatric draft is active or signed';
  end if;
  if (select count(*) from public.triage_protocols where notes like 'S59 draft:%') <> 1 then
    raise exception 'S59 assertion: expected exactly one S59 draft row';
  end if;
  if (select jsonb_array_length(config -> 'pathways') from public.triage_protocols where notes like 'S59 draft:%') < 6 then
    raise exception 'S59 assertion: the draft does not carry the adult pathways plus three paediatric ones';
  end if;
  if (select (config ->> 'version')::integer from public.triage_protocols where notes like 'S59 draft:%') <> (select version from public.triage_protocols where notes like 'S59 draft:%') then
    raise exception 'S59 assertion: the config version does not match the row version';
  end if;
end $$;
