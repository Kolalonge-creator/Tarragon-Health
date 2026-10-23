-- S59d part 1 of 4: ONE new DRAFT triage protocol version that adds the highest-value Nigerian presentations, for the Chief Medical Officer
-- to read, edit and sign: adult fever with suspected malaria or typhoid (replaces the v2 draft's `fever`, same key, every old rule key kept),
-- danger signs in pregnancy, complications of high blood pressure, complications of diabetes.
--
-- THIS ADDS ONE UNSIGNED, INACTIVE `triage_protocols` ROW and nothing else. No agent signs or activates anything: only the Chief Medical
-- Officer, through public.sign_triage_protocols(), can make it active, and the app loads only an ACTIVE, SIGNED row (liveProtocolConfig).
-- Until then the checker (also behind symptom_checker_enabled, OFF) offers the signed adult pathways only.
--
-- THE NEW VERSION IS A SUPERSET. Its base is the S59 merged draft (the signed adult pathways with the chest pain cardiac pattern having no
-- severity floor, the adult v2 extras, the three paediatric drafts); any pathway of the currently ACTIVE config whose key the base lacks is
-- carried too, so signing this version cannot silently drop a signed pathway. A base pathway whose key S59d redrafts (`fever`) is replaced in
-- place; every other base pathway is kept untouched. The version number is computed when the migration is applied (highest existing plus
-- one), never typed by hand. SIGN THIS VERSION, NOT THE S59 DRAFT: signing replaces the whole active config (OQ-S59-05), and this one
-- contains everything the S59 draft does.
--
-- The criteria are a transcription of widely taught danger signs (WHO severe malaria features, WHO and CDC/ACOG pregnancy danger signs,
-- ESC/ESH and ACC/AHA hypertensive emergency definitions, FAST/BE-FAST, ADA hypoglycaemia levels and hyperglycaemic crises consensus, IWGDF/IDSA
-- diabetic foot guidance), same class as the signed pathways, and are NOT independently clinically reviewed. Sources, what could not be
-- verified and the questions the CMO must answer: docs/research/S59d-pathway-coverage.md. The JSON below is a copy of
-- packages/symptom-triage-engine/src/protocols/s59d-drafts.ts; a Jest test fails if the two differ.
--
-- ROWS AFFECTED: one row inserted (idempotent: skipped if a row with this note already exists). No existing row changes.

do $$
declare
  v_version integer;
  v_base jsonb;
  v_active jsonb;
  v_s59d jsonb;
  v_pathways jsonb;
  v_config jsonb;
begin
  if exists (select 1 from public.triage_protocols where notes like 'S59d draft:%') then
    return;
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.triage_protocols;
  select config into v_base from public.triage_protocols where notes like 'S59 draft:%' order by version desc limit 1;
  select config into v_active from public.triage_protocols where is_active limit 1;
  -- no S59 draft (it was never applied): fall back to the active config, then to version 1
  v_base := coalesce(v_base, v_active, (select config from public.triage_protocols where version = 1));
  if v_base is null then
    raise exception 'S59d: no base triage protocol (no S59 draft, no active config and no version 1) to carry the existing pathways';
  end if;
-- s59d-draft-begin
  v_s59d := $json$
[
 {
  "key": "fever",
  "label": "Fever",
  "knownAssociatedSymptoms": [
   "neck_stiffness",
   "non_blanching_rash",
   "breathlessness",
   "confusion",
   "seizure",
   "reduced_urine_output",
   "prostration",
   "abnormal_bleeding",
   "dark_urine",
   "jaundice",
   "severe_pallor",
   "persistent_vomiting",
   "rigid_abdomen",
   "blood_in_stool"
  ],
  "knownTriggers": [
   "recent_travel"
  ],
  "knownHistory": [
   "pregnant",
   "hiv_or_immunocompromised",
   "cancer_history",
   "sickle_cell_disease"
  ],
  "redFlagScreen": [
   {
    "key": "fever.meningitic_signs",
    "label": "Fever with neck stiffness",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "neck_stiffness"
     ]
    }
   },
   {
    "key": "fever.non_blanching_rash",
    "label": "Fever with a rash that does not fade when pressed",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "non_blanching_rash"
     ]
    }
   },
   {
    "key": "fever.breathlessness",
    "label": "Fever with significant breathlessness",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "breathlessness"
     ],
     "minSeverity": 6
    }
   },
   {
    "key": "fever.confusion_or_seizure",
    "label": "Fever with confusion or a seizure",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "confusion",
      "seizure"
     ]
    }
   },
   {
    "key": "fever.very_high_temperature",
    "label": "Very high temperature",
    "category": "emergency",
    "rule": {
     "measurementAtLeast": {
      "key": "temperature_c",
      "value": 40
     }
    }
   },
   {
    "key": "fever.immunocompromised",
    "label": "Fever in an immunocompromised or cancer patient",
    "category": "urgent",
    "rule": {
     "anyHistory": [
      "hiv_or_immunocompromised",
      "cancer_history"
     ],
     "minSeverity": 5
    }
   },
   {
    "key": "fever.pregnant",
    "label": "Fever in pregnancy",
    "category": "urgent",
    "rule": {
     "anyHistory": [
      "pregnant"
     ],
     "minSeverity": 5
    }
   },
   {
    "key": "fever.reduced_urine_output",
    "label": "Fever with reduced urine output",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "reduced_urine_output"
     ]
    }
   },
   {
    "key": "fever.prostration",
    "label": "Fever and too weak to sit up or stand without help",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "prostration"
     ]
    }
   },
   {
    "key": "fever.abnormal_bleeding",
    "label": "Fever with bleeding from the gums, nose or elsewhere",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "abnormal_bleeding"
     ]
    }
   },
   {
    "key": "fever.dark_urine",
    "label": "Fever with very dark or cola-coloured urine",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "dark_urine"
     ]
    }
   },
   {
    "key": "fever.rigid_abdomen",
    "label": "Fever with a hard, board-like belly",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "rigid_abdomen"
     ]
    }
   },
   {
    "key": "fever.blood_in_stool",
    "label": "Fever with blood in the stool or black stool",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "blood_in_stool"
     ]
    }
   },
   {
    "key": "fever.jaundice",
    "label": "Fever with yellow eyes or skin",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "jaundice"
     ]
    }
   },
   {
    "key": "fever.severe_pallor",
    "label": "Fever with a very pale look",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "severe_pallor"
     ]
    }
   },
   {
    "key": "fever.persistent_vomiting",
    "label": "Fever with vomiting that will not stop",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "persistent_vomiting"
     ]
    }
   },
   {
    "key": "fever.breathlessness_any",
    "label": "Fever with breathlessness",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "breathlessness"
     ]
    }
   },
   {
    "key": "fever.pregnant_any",
    "label": "Fever in pregnancy",
    "category": "urgent",
    "rule": {
     "anyHistory": [
      "pregnant"
     ]
    }
   },
   {
    "key": "fever.sickle_cell",
    "label": "Fever in someone with sickle cell disease",
    "category": "urgent",
    "rule": {
     "anyHistory": [
      "sickle_cell_disease"
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
    "prompt": "Has the fever lasted 3 days or more, or does it keep coming back?",
    "onYes": "outcome_urgent_prolonged",
    "onNo": "hydration_check"
   },
   "hydration_check": {
    "type": "question",
    "kind": "boolean",
    "key": "hydration_check",
    "prompt": "Are you able to keep fluids down, and passing urine normally?",
    "onYes": "severity_check",
    "onNo": "outcome_urgent_dehydration"
   },
   "severity_check": {
    "type": "question",
    "kind": "choice",
    "key": "severity_check",
    "prompt": "How high does the fever feel, and how are you coping?",
    "options": [
     {
      "value": "mild",
      "label": "Mild - I can carry on close to normal",
      "next": "mild_test_check"
     },
     {
      "value": "moderate",
      "label": "Moderate - uncomfortable, need to rest",
      "next": "moderate_test_check"
     },
     {
      "value": "high",
      "label": "High - shivering, very unwell",
      "next": "outcome_urgent_high"
     }
    ]
   },
   "mild_test_check": {
    "type": "question",
    "kind": "boolean",
    "key": "mild_test_check",
    "prompt": "Have you had a malaria test (a quick finger-prick test or a blood slide) during this illness?",
    "onYes": "mild_result_check",
    "onNo": "outcome_routine_untested"
   },
   "mild_result_check": {
    "type": "question",
    "kind": "boolean",
    "key": "mild_result_check",
    "prompt": "Was the malaria test positive?",
    "onYes": "outcome_urgent_malaria_positive",
    "onNo": "outcome_self_mild"
   },
   "moderate_test_check": {
    "type": "question",
    "kind": "boolean",
    "key": "moderate_test_check",
    "prompt": "Have you had a malaria test (a quick finger-prick test or a blood slide) during this illness?",
    "onYes": "moderate_result_check",
    "onNo": "outcome_routine_untested"
   },
   "moderate_result_check": {
    "type": "question",
    "kind": "boolean",
    "key": "moderate_result_check",
    "prompt": "Was the malaria test positive?",
    "onYes": "outcome_urgent_malaria_positive",
    "onNo": "outcome_routine_moderate"
   },
   "outcome_urgent_prolonged": {
    "type": "outcome",
    "key": "outcome_urgent_prolonged",
    "category": "urgent",
    "safetyNetMessageKey": "fever.urgent_prolonged",
    "clinicianReviewRequired": true,
    "rationale": "Fever lasting 3 days or more, or recurring - needs assessment to find a cause, including malaria and typhoid testing."
   },
   "outcome_urgent_dehydration": {
    "type": "outcome",
    "key": "outcome_urgent_dehydration",
    "category": "urgent",
    "safetyNetMessageKey": "fever.urgent_dehydration",
    "clinicianReviewRequired": true,
    "rationale": "Unable to keep fluids down or reduced urine output alongside fever - dehydration risk, needs prompt assessment."
   },
   "outcome_routine_untested": {
    "type": "outcome",
    "key": "outcome_routine_untested",
    "category": "routine",
    "safetyNetMessageKey": "fever.routine_untested",
    "clinicianReviewRequired": false,
    "rationale": "Fever with no malaria test yet - a test comes before any treatment, so the next step is to get tested."
   },
   "outcome_urgent_malaria_positive": {
    "type": "outcome",
    "key": "outcome_urgent_malaria_positive",
    "category": "urgent",
    "safetyNetMessageKey": "fever.urgent_malaria_positive",
    "clinicianReviewRequired": true,
    "rationale": "A positive malaria test needs a clinician to confirm the treatment and check for warning signs."
   },
   "outcome_self_mild": {
    "type": "outcome",
    "key": "outcome_self_mild",
    "category": "self_management",
    "safetyNetMessageKey": "fever.self_mild",
    "clinicianReviewRequired": false,
    "rationale": "Mild fever, malaria test negative, no red flag, coping and hydrated - self-care and monitoring appropriate."
   },
   "outcome_routine_moderate": {
    "type": "outcome",
    "key": "outcome_routine_moderate",
    "category": "routine",
    "safetyNetMessageKey": "fever.routine_moderate",
    "clinicianReviewRequired": false,
    "rationale": "Moderate, non-red-flag fever with a negative malaria test - suitable for a routine appointment if it does not settle."
   },
   "outcome_urgent_high": {
    "type": "outcome",
    "key": "outcome_urgent_high",
    "category": "urgent",
    "safetyNetMessageKey": "fever.urgent_high",
    "clinicianReviewRequired": true,
    "rationale": "High fever with significant systemic upset, malaria test negative, no other explanation from the questions asked - routed to prompt review."
   }
  },
  "fallbackOutcome": {
   "type": "outcome",
   "key": "fallback",
   "category": "urgent",
   "safetyNetMessageKey": "generic.fallback_review",
   "clinicianReviewRequired": true,
   "rationale": "Triage graph reached an unexpected state - routed to human review as a safety default."
  }
 },
 {
  "key": "pregnancy_danger_signs",
  "label": "A worry while pregnant",
  "knownAssociatedSymptoms": [
   "seizure",
   "heavy_vaginal_bleeding",
   "vaginal_bleeding",
   "headache",
   "visual_disturbance",
   "vision_loss",
   "severe_abdominal_pain",
   "reduced_fetal_movement",
   "leaking_fluid",
   "face_or_hand_swelling",
   "fever",
   "prostration",
   "breathlessness",
   "chest_pain",
   "fainting"
  ],
  "knownTriggers": [],
  "knownHistory": [
   "pregnant"
  ],
  "redFlagScreen": [
   {
    "key": "pregnancy_danger_signs.seizure",
    "label": "A fit in pregnancy",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "seizure"
     ]
    }
   },
   {
    "key": "pregnancy_danger_signs.heavy_bleeding",
    "label": "Heavy bleeding from the vagina in pregnancy",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "heavy_vaginal_bleeding"
     ]
    }
   },
   {
    "key": "pregnancy_danger_signs.headache_with_vision",
    "label": "A headache with changes in how you see",
    "category": "emergency",
    "rule": {
     "allAssociatedSymptoms": [
      "headache",
      "visual_disturbance"
     ]
    }
   },
   {
    "key": "pregnancy_danger_signs.vision_loss",
    "label": "Losing your sight in pregnancy",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "vision_loss"
     ]
    }
   },
   {
    "key": "pregnancy_danger_signs.severe_abdominal_pain",
    "label": "Severe belly pain in pregnancy",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "severe_abdominal_pain"
     ]
    }
   },
   {
    "key": "pregnancy_danger_signs.too_weak",
    "label": "A fever and too weak to get out of bed",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "prostration"
     ]
    }
   },
   {
    "key": "pregnancy_danger_signs.breathing",
    "label": "Struggling to breathe, or chest pain, in pregnancy",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "breathlessness",
      "chest_pain"
     ]
    }
   },
   {
    "key": "pregnancy_danger_signs.bleeding",
    "label": "Bleeding from the vagina in pregnancy",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "vaginal_bleeding"
     ]
    }
   },
   {
    "key": "pregnancy_danger_signs.reduced_movement",
    "label": "The baby moving less than usual",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "reduced_fetal_movement"
     ]
    }
   },
   {
    "key": "pregnancy_danger_signs.headache",
    "label": "A headache in pregnancy",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "headache"
     ]
    }
   },
   {
    "key": "pregnancy_danger_signs.vision_change",
    "label": "A change in how you see in pregnancy",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "visual_disturbance"
     ]
    }
   },
   {
    "key": "pregnancy_danger_signs.fever",
    "label": "A fever in pregnancy",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "fever"
     ]
    }
   },
   {
    "key": "pregnancy_danger_signs.leaking_fluid",
    "label": "Fluid leaking from the vagina in pregnancy",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "leaking_fluid"
     ]
    }
   },
   {
    "key": "pregnancy_danger_signs.swelling",
    "label": "Swelling of the face or hands in pregnancy",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "face_or_hand_swelling"
     ]
    }
   },
   {
    "key": "pregnancy_danger_signs.fainting",
    "label": "Fainting in pregnancy",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "fainting"
     ]
    }
   }
  ],
  "startNodeKey": "recent_check",
  "nodes": {
   "recent_check": {
    "type": "question",
    "kind": "boolean",
    "key": "recent_check",
    "prompt": "Did this start, or get worse, in the last day?",
    "onYes": "outcome_urgent_recent",
    "onNo": "movement_check"
   },
   "movement_check": {
    "type": "question",
    "kind": "boolean",
    "key": "movement_check",
    "prompt": "Is the baby moving as much as usual (if you are far enough along to feel it)?",
    "onYes": "outcome_routine_pregnancy",
    "onNo": "outcome_urgent_movement"
   },
   "outcome_urgent_recent": {
    "type": "outcome",
    "key": "outcome_urgent_recent",
    "category": "urgent",
    "safetyNetMessageKey": "pregnancy_danger_signs.urgent_recent",
    "clinicianReviewRequired": true,
    "rationale": "A new or worsening worry in pregnancy needs a clinician to look promptly."
   },
   "outcome_urgent_movement": {
    "type": "outcome",
    "key": "outcome_urgent_movement",
    "category": "urgent",
    "safetyNetMessageKey": "pregnancy_danger_signs.urgent_movement",
    "clinicianReviewRequired": true,
    "rationale": "Not feeling the baby move as usual needs to be checked promptly."
   },
   "outcome_routine_pregnancy": {
    "type": "outcome",
    "key": "outcome_routine_pregnancy",
    "category": "routine",
    "safetyNetMessageKey": "pregnancy_danger_signs.routine",
    "clinicianReviewRequired": true,
    "rationale": "A worry in pregnancy with no danger sign reported: a clinician reviews it. Never self-care."
   }
  },
  "fallbackOutcome": {
   "type": "outcome",
   "key": "fallback",
   "category": "urgent",
   "safetyNetMessageKey": "generic.fallback_review",
   "clinicianReviewRequired": true,
   "rationale": "Triage graph reached an unexpected state - routed to human review as a safety default."
  }
 },
 {
  "key": "hypertension_complication",
  "label": "High blood pressure and a warning sign",
  "knownAssociatedSymptoms": [
   "severe_headache",
   "chest_pain",
   "breathlessness",
   "breathless_lying_flat",
   "weakness_or_numbness",
   "facial_droop",
   "speech_difficulty",
   "vision_loss",
   "visual_disturbance",
   "confusion",
   "seizure",
   "nosebleed_heavy",
   "palpitations",
   "fainting"
  ],
  "knownTriggers": [],
  "knownHistory": [
   "hypertension",
   "pregnant",
   "diabetes",
   "known_heart_disease"
  ],
  "redFlagScreen": [
   {
    "key": "hypertension_complication.chest_pain",
    "label": "Chest pain with high blood pressure",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "chest_pain"
     ]
    }
   },
   {
    "key": "hypertension_complication.stroke_signs",
    "label": "New weakness, numbness, drooping face, trouble speaking, sight loss, confusion or a fit",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "weakness_or_numbness",
      "facial_droop",
      "speech_difficulty",
      "vision_loss",
      "confusion",
      "seizure"
     ]
    }
   },
   {
    "key": "hypertension_complication.very_high_top_with_symptom",
    "label": "A very high top number with a warning sign",
    "category": "emergency",
    "rule": {
     "measurementAtLeast": {
      "key": "systolic",
      "value": 180
     },
     "anyAssociatedSymptom": [
      "severe_headache",
      "visual_disturbance",
      "breathlessness",
      "nosebleed_heavy",
      "palpitations",
      "fainting"
     ]
    }
   },
   {
    "key": "hypertension_complication.very_high_bottom_with_symptom",
    "label": "A very high bottom number with a warning sign",
    "category": "emergency",
    "rule": {
     "measurementAtLeast": {
      "key": "diastolic",
      "value": 120
     },
     "anyAssociatedSymptom": [
      "severe_headache",
      "visual_disturbance",
      "breathlessness",
      "nosebleed_heavy",
      "palpitations",
      "fainting"
     ]
    }
   },
   {
    "key": "hypertension_complication.breathless_lying_flat",
    "label": "Breathless when lying flat",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "breathless_lying_flat"
     ]
    }
   },
   {
    "key": "hypertension_complication.pregnant_warning",
    "label": "High blood pressure in pregnancy with a headache or a change in sight",
    "category": "emergency",
    "rule": {
     "anyHistory": [
      "pregnant"
     ],
     "anyAssociatedSymptom": [
      "severe_headache",
      "visual_disturbance"
     ]
    }
   },
   {
    "key": "hypertension_complication.very_high_top",
    "label": "A very high top number",
    "category": "urgent",
    "rule": {
     "measurementAtLeast": {
      "key": "systolic",
      "value": 180
     }
    }
   },
   {
    "key": "hypertension_complication.very_high_bottom",
    "label": "A very high bottom number",
    "category": "urgent",
    "rule": {
     "measurementAtLeast": {
      "key": "diastolic",
      "value": 120
     }
    }
   },
   {
    "key": "hypertension_complication.severe_headache",
    "label": "A severe headache with high blood pressure",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "severe_headache"
     ]
    }
   },
   {
    "key": "hypertension_complication.breathlessness",
    "label": "Breathlessness with high blood pressure",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "breathlessness"
     ]
    }
   },
   {
    "key": "hypertension_complication.pregnant",
    "label": "High blood pressure while pregnant",
    "category": "urgent",
    "rule": {
     "anyHistory": [
      "pregnant"
     ]
    }
   }
  ],
  "startNodeKey": "higher_check",
  "nodes": {
   "higher_check": {
    "type": "question",
    "kind": "boolean",
    "key": "higher_check",
    "prompt": "Has your blood pressure been higher than usual in the last few days?",
    "onYes": "missed_medicine_check",
    "onNo": "outcome_routine_review"
   },
   "missed_medicine_check": {
    "type": "question",
    "kind": "boolean",
    "key": "missed_medicine_check",
    "prompt": "Have you missed your blood pressure tablets for two days or more?",
    "onYes": "outcome_routine_missed",
    "onNo": "outcome_urgent_on_treatment"
   },
   "outcome_routine_review": {
    "type": "outcome",
    "key": "outcome_routine_review",
    "category": "routine",
    "safetyNetMessageKey": "hypertension_complication.routine_review",
    "clinicianReviewRequired": true,
    "rationale": "Blood pressure worry with no warning sign and no higher readings: a clinician reviews it."
   },
   "outcome_routine_missed": {
    "type": "outcome",
    "key": "outcome_routine_missed",
    "category": "routine",
    "safetyNetMessageKey": "hypertension_complication.routine_missed",
    "clinicianReviewRequired": true,
    "rationale": "Higher readings after missed tablets and no warning sign: a clinician reviews the plan."
   },
   "outcome_urgent_on_treatment": {
    "type": "outcome",
    "key": "outcome_urgent_on_treatment",
    "category": "urgent",
    "safetyNetMessageKey": "hypertension_complication.urgent_on_treatment",
    "clinicianReviewRequired": true,
    "rationale": "Higher readings despite taking tablets needs a prompt review of the treatment."
   }
  },
  "fallbackOutcome": {
   "type": "outcome",
   "key": "fallback",
   "category": "urgent",
   "safetyNetMessageKey": "generic.fallback_review",
   "clinicianReviewRequired": true,
   "rationale": "Triage graph reached an unexpected state - routed to human review as a safety default."
  }
 },
 {
  "key": "diabetes_complication",
  "label": "Diabetes and a warning sign",
  "knownAssociatedSymptoms": [
   "hypo_warning_signs",
   "confusion",
   "seizure",
   "unresponsive",
   "cannot_swallow",
   "very_thirsty_passing_lots_of_urine",
   "persistent_vomiting",
   "severe_abdominal_pain",
   "deep_fast_breathing",
   "fruity_breath",
   "very_drowsy",
   "ketones_present",
   "foot_ulcer_or_blister",
   "foot_red_hot_swollen",
   "foot_discharge_or_smell",
   "foot_black_or_dead_skin",
   "fever"
  ],
  "knownTriggers": [
   "insulin_or_tablet_dose_mistake",
   "not_eaten",
   "recent_illness"
  ],
  "knownHistory": [
   "diabetes",
   "on_insulin",
   "pregnant"
  ],
  "redFlagScreen": [
   {
    "key": "diabetes_complication.neuro_signs",
    "label": "Confusion, a fit, cannot be woken or cannot swallow with diabetes",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "confusion",
      "seizure",
      "unresponsive",
      "cannot_swallow"
     ]
    }
   },
   {
    "key": "diabetes_complication.dka_breathing",
    "label": "Deep fast breathing, fruity breath or being very drowsy with diabetes",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "deep_fast_breathing",
      "fruity_breath",
      "very_drowsy"
     ]
    }
   },
   {
    "key": "diabetes_complication.vomiting_high_sugar",
    "label": "Vomiting that will not stop with a high sugar reading",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "persistent_vomiting"
     ],
     "measurementAtLeast": {
      "key": "glucose_mmol_l",
      "value": 11
     }
    }
   },
   {
    "key": "diabetes_complication.vomiting_ketones",
    "label": "Vomiting that will not stop with ketones in the urine or blood",
    "category": "emergency",
    "rule": {
     "allAssociatedSymptoms": [
      "persistent_vomiting",
      "ketones_present"
     ]
    }
   },
   {
    "key": "diabetes_complication.very_high_sugar",
    "label": "A very high sugar reading",
    "category": "emergency",
    "rule": {
     "measurementAtLeast": {
      "key": "glucose_mmol_l",
      "value": 33.3
     }
    }
   },
   {
    "key": "diabetes_complication.foot_dead_skin",
    "label": "Black or dead skin on a foot",
    "category": "emergency",
    "rule": {
     "anyAssociatedSymptom": [
      "foot_black_or_dead_skin"
     ]
    }
   },
   {
    "key": "diabetes_complication.foot_sore_fever",
    "label": "A foot sore with a fever",
    "category": "emergency",
    "rule": {
     "allAssociatedSymptoms": [
      "foot_ulcer_or_blister",
      "fever"
     ]
    }
   },
   {
    "key": "diabetes_complication.foot_hot_fever",
    "label": "A red, hot, swollen foot with a fever",
    "category": "emergency",
    "rule": {
     "allAssociatedSymptoms": [
      "foot_red_hot_swollen",
      "fever"
     ]
    }
   },
   {
    "key": "diabetes_complication.foot_discharge_fever",
    "label": "A foot with discharge or a smell, and a fever",
    "category": "emergency",
    "rule": {
     "allAssociatedSymptoms": [
      "foot_discharge_or_smell",
      "fever"
     ]
    }
   },
   {
    "key": "diabetes_complication.low_sugar",
    "label": "A low sugar reading",
    "category": "urgent",
    "rule": {
     "measurementBelow": {
      "key": "glucose_mmol_l",
      "value": 3.8
     }
    }
   },
   {
    "key": "diabetes_complication.low_sugar_signs",
    "label": "Signs of a low sugar",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "hypo_warning_signs"
     ]
    }
   },
   {
    "key": "diabetes_complication.ketones",
    "label": "Ketones in the urine or blood",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "ketones_present"
     ]
    }
   },
   {
    "key": "diabetes_complication.high_sugar_symptoms",
    "label": "A high sugar reading with thirst or passing a lot of urine",
    "category": "urgent",
    "rule": {
     "measurementAtLeast": {
      "key": "glucose_mmol_l",
      "value": 20
     },
     "anyAssociatedSymptom": [
      "very_thirsty_passing_lots_of_urine"
     ]
    }
   },
   {
    "key": "diabetes_complication.abdominal_pain",
    "label": "Severe belly pain with diabetes",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "severe_abdominal_pain"
     ]
    }
   },
   {
    "key": "diabetes_complication.vomiting",
    "label": "Vomiting that will not stop with diabetes",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "persistent_vomiting"
     ]
    }
   },
   {
    "key": "diabetes_complication.foot_problem",
    "label": "A new foot sore, redness, swelling, discharge or smell",
    "category": "urgent",
    "rule": {
     "anyAssociatedSymptom": [
      "foot_ulcer_or_blister",
      "foot_red_hot_swollen",
      "foot_discharge_or_smell"
     ]
    }
   },
   {
    "key": "diabetes_complication.dose_mistake",
    "label": "A mix-up with insulin or tablets",
    "category": "urgent",
    "rule": {
     "anyTrigger": [
      "insulin_or_tablet_dose_mistake"
     ]
    }
   }
  ],
  "startNodeKey": "thirst_check",
  "nodes": {
   "thirst_check": {
    "type": "question",
    "kind": "boolean",
    "key": "thirst_check",
    "prompt": "In the last day, have you been much more thirsty than usual, passing a lot of urine, or feeling unusually tired?",
    "onYes": "outcome_urgent_high_signs",
    "onNo": "foot_check"
   },
   "foot_check": {
    "type": "question",
    "kind": "boolean",
    "key": "foot_check",
    "prompt": "Is there any new sore, blister, colour change or swelling on a foot?",
    "onYes": "outcome_urgent_foot",
    "onNo": "low_check"
   },
   "low_check": {
    "type": "question",
    "kind": "boolean",
    "key": "low_check",
    "prompt": "In the last week, have you had a low sugar episode (shaky, sweaty, confused) that you had to treat?",
    "onYes": "outcome_routine_low",
    "onNo": "outcome_routine_diabetes"
   },
   "outcome_urgent_high_signs": {
    "type": "outcome",
    "key": "outcome_urgent_high_signs",
    "category": "urgent",
    "safetyNetMessageKey": "diabetes_complication.urgent_high_signs",
    "clinicianReviewRequired": true,
    "rationale": "Thirst, passing a lot of urine or unusual tiredness with diabetes needs the sugar checked and a clinician to look promptly."
   },
   "outcome_urgent_foot": {
    "type": "outcome",
    "key": "outcome_urgent_foot",
    "category": "urgent",
    "safetyNetMessageKey": "diabetes_complication.urgent_foot",
    "clinicianReviewRequired": true,
    "rationale": "A new foot problem in diabetes needs to be looked at promptly, because infection can spread quickly."
   },
   "outcome_routine_low": {
    "type": "outcome",
    "key": "outcome_routine_low",
    "category": "routine",
    "safetyNetMessageKey": "diabetes_complication.routine_low",
    "clinicianReviewRequired": true,
    "rationale": "A treated low sugar episode this week: a clinician reviews the treatment plan."
   },
   "outcome_routine_diabetes": {
    "type": "outcome",
    "key": "outcome_routine_diabetes",
    "category": "routine",
    "safetyNetMessageKey": "diabetes_complication.routine",
    "clinicianReviewRequired": true,
    "rationale": "A diabetes worry with no warning sign reported: a clinician reviews it."
   }
  },
  "fallbackOutcome": {
   "type": "outcome",
   "key": "fallback",
   "category": "urgent",
   "safetyNetMessageKey": "generic.fallback_review",
   "clinicianReviewRequired": true,
   "rationale": "Triage graph reached an unexpected state - routed to human review as a safety default."
  }
 }
]
$json$::jsonb;
-- s59d-draft-end
  -- 1. every base pathway, in order; a pathway S59d redrafts is replaced in place
  select coalesce(jsonb_agg(coalesce(
           (select n from jsonb_array_elements(v_s59d) n where n ->> 'key' = b.p ->> 'key' limit 1), b.p) order by b.po), '[]'::jsonb)
    into v_pathways
    from jsonb_array_elements(v_base -> 'pathways') with ordinality as b(p, po);
  -- 2. a pathway of the ACTIVE config that the base lacks is kept (nothing signed is dropped by signing this version)
  v_pathways := v_pathways || coalesce((
    select jsonb_agg(a.p order by a.po)
      from jsonb_array_elements(coalesce(v_active -> 'pathways', '[]'::jsonb)) with ordinality as a(p, po)
     where not exists (select 1 from jsonb_array_elements(v_pathways) x where x ->> 'key' = a.p ->> 'key')), '[]'::jsonb);
  -- 3. the S59d pathways the base did not have
  v_pathways := v_pathways || coalesce((
    select jsonb_agg(n.p order by n.po)
      from jsonb_array_elements(v_s59d) with ordinality as n(p, po)
     where not exists (select 1 from jsonb_array_elements(v_pathways) x where x ->> 'key' = n.p ->> 'key')), '[]'::jsonb);
  v_config := jsonb_build_object('version', v_version, 'pathways', v_pathways);
  insert into public.triage_protocols (version, config, notes, is_active)
  values (v_version, v_config,
    'S59d draft: UNSIGNED and INACTIVE. A superset of the S59 draft (signed adult pathways, chest pain with no severity floor, adult v2 extras, three paediatric pathways) plus adult fever with suspected malaria or typhoid (redraft of the v2 fever, same key), danger signs in pregnancy, complications of high blood pressure and complications of diabetes. Criteria transcribed from WHO, CDC/ACOG, ESC/ESH, ACC/AHA, ADA and IWGDF material, not independently clinically reviewed (see docs/research/S59d-pathway-coverage.md). Needs the Chief Medical Officer to review, edit and sign through sign_triage_protocols. Signing replaces the whole active config. Sign this version, not the S59 draft.',
    false);
end $$;

do $$
declare
  r public.triage_protocols%rowtype;
begin
  if (select count(*) from public.triage_protocols where notes like 'S59d draft:%') <> 1 then
    raise exception 'S59d assertion: expected exactly one S59d draft row';
  end if;
  select * into r from public.triage_protocols where notes like 'S59d draft:%';
  if r.is_active or r.approved_at is not null or r.approved_by is not null then
    raise exception 'S59d assertion: the S59d draft is active or signed';
  end if;
  if (r.config ->> 'version')::integer <> r.version then
    raise exception 'S59d assertion: the config version does not match the row version';
  end if;
  if (select count(*) from public.triage_protocols where is_active) > 1 then
    raise exception 'S59d assertion: more than one active triage protocol - this migration must never activate anything';
  end if;
  if exists (select 1 from jsonb_array_elements(r.config -> 'pathways') p group by p ->> 'key' having count(*) > 1) then
    raise exception 'S59d assertion: a pathway key appears twice';
  end if;
  if (select count(distinct p ->> 'key') from jsonb_array_elements(r.config -> 'pathways') p
       where p ->> 'key' in ('fever', 'pregnancy_danger_signs', 'hypertension_complication', 'diabetes_complication')) <> 4 then
    raise exception 'S59d assertion: the four S59d pathways are not all present';
  end if;
  -- the redrafted fever keeps every rule key it had before (the previous draft's fever, if there was one)
  if exists (
    select 1
      from public.triage_protocols o
      cross join lateral jsonb_array_elements(o.config -> 'pathways') op
      cross join lateral jsonb_array_elements(op -> 'redFlagScreen') orf
     where o.id <> r.id and op ->> 'key' = 'fever' and o.notes like 'S59 draft:%'
       and not exists (
         select 1 from jsonb_array_elements(r.config -> 'pathways') np
           cross join lateral jsonb_array_elements(np -> 'redFlagScreen') nrf
          where np ->> 'key' = 'fever' and nrf ->> 'key' = orf ->> 'key')) then
    raise exception 'S59d assertion: the redrafted fever dropped a rule key the S59 draft had';
  end if;
end $$;
