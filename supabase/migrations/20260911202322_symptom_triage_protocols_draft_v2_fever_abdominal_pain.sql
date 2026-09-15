-- Symptom Assessment & Triage Engine — draft v2, adding two more presenting
-- complaints (fever, abdominal pain) to the three the signed v1 config
-- covers (headache, chest_pain, breathlessness). The "check symptoms"
-- entry screen only offers whatever public.active_triage_protocol_config()
-- returns, so its list of starting symptoms is exactly as wide as the
-- signed protocol's pathway list — three today.
--
-- Same discipline as v1 (20260829094847_symptom_triage_protocols_config.sql):
-- seeded UNSIGNED and INACTIVE. This does NOT touch is_active anywhere, does
-- NOT retire v1, and does NOT make more symptoms available to patients on
-- its own — only public.sign_triage_protocols(), gated to an active
-- Clinical Director, can do that (see that function's own definition,
-- unchanged by this migration). fever/abdominal_pain's red-flag criteria
-- below are a transcription of widely-taught general-practice red-flag
-- criteria (the same class already used for v1's three pathways), NOT
-- independently clinically reviewed — flagging for Clinical Director review
-- before sign-off, same as v1's own notes column said of itself.
--
-- Left for whoever reviews this: packages/symptom-triage-engine/src/
-- protocols/index.ts's SEED_TRIAGE_PROTOCOL_CONFIG is documented as the
-- hand-kept-in-sync TS source for whichever version is actually SIGNED —
-- since v1 remains the signed version after this migration, that file is
-- deliberately left untouched here; update it together with the DB config
-- at the point this (or a revised version of it) is actually signed.

insert into public.triage_protocols (version, config, notes, is_active)
values (
  2,
  '{
    "version": 2,
    "pathways": [
      {
        "key": "headache",
        "label": "Headache",
        "knownAssociatedSymptoms": ["fever", "neck_stiffness", "visual_disturbance", "vision_loss", "weakness_or_numbness", "confusion", "nausea_vomiting"],
        "knownTriggers": ["head_injury_recent", "straining_coughing_or_sex"],
        "knownHistory": ["pregnant", "hiv_or_immunocompromised", "cancer_history", "anticoagulant_use"],
        "redFlagScreen": [
          {"key": "headache.thunderclap_onset", "label": "Sudden, severe (thunderclap) headache", "category": "emergency", "rule": {"onset": "sudden", "minSeverity": 8}},
          {"key": "headache.neuro_deficit", "label": "Headache with new weakness, numbness or confusion", "category": "emergency", "rule": {"anyAssociatedSymptom": ["weakness_or_numbness", "confusion"]}},
          {"key": "headache.meningitic_signs", "label": "Headache with fever and neck stiffness", "category": "emergency", "rule": {"allAssociatedSymptoms": ["neck_stiffness", "fever"]}},
          {"key": "headache.vision_loss", "label": "Headache with loss of vision", "category": "emergency", "rule": {"anyAssociatedSymptom": ["vision_loss"]}},
          {"key": "headache.recent_head_injury", "label": "Headache after a recent head injury", "category": "emergency", "rule": {"anyTrigger": ["head_injury_recent"], "minSeverity": 6}},
          {"key": "headache.immunocompromised_new_severe", "label": "New severe headache in an immunocompromised or cancer patient", "category": "urgent", "rule": {"anyHistory": ["hiv_or_immunocompromised", "cancer_history"], "minSeverity": 6}},
          {"key": "headache.pregnancy_severe", "label": "Severe headache in pregnancy", "category": "urgent", "rule": {"anyHistory": ["pregnant"], "minSeverity": 6}}
        ],
        "startNodeKey": "duration_check",
        "nodes": {
          "duration_check": {"type": "question", "kind": "boolean", "key": "duration_check", "prompt": "Has this headache lasted more than 3 days, or is it a pattern you''ve never had before?", "onYes": "worsening_check", "onNo": "frequency_check"},
          "worsening_check": {"type": "question", "kind": "boolean", "key": "worsening_check", "prompt": "Is it getting worse day by day, or waking you up from sleep?", "onYes": "outcome_urgent_worsening", "onNo": "frequency_check"},
          "frequency_check": {"type": "question", "kind": "boolean", "key": "frequency_check", "prompt": "Do you get headaches like this often - more than 10 days a month?", "onYes": "outcome_routine_frequent", "onNo": "severity_check"},
          "severity_check": {"type": "question", "kind": "choice", "key": "severity_check", "prompt": "How would you describe the pain right now?", "options": [
            {"value": "mild", "label": "Mild - I can carry on as normal", "next": "outcome_self_mild"},
            {"value": "moderate", "label": "Moderate - it''s slowing me down", "next": "outcome_routine_moderate"},
            {"value": "severe", "label": "Severe - it''s hard to do anything", "next": "outcome_urgent_severe"}
          ]},
          "outcome_urgent_worsening": {"type": "outcome", "key": "outcome_urgent_worsening", "category": "urgent", "safetyNetMessageKey": "headache.urgent_worsening", "clinicianReviewRequired": false, "rationale": "Progressive pattern or waking from sleep - needs prompt clinical assessment to rule out a secondary cause."},
          "outcome_routine_frequent": {"type": "outcome", "key": "outcome_routine_frequent", "category": "routine", "safetyNetMessageKey": "headache.routine_frequent", "clinicianReviewRequired": false, "rationale": "Frequent headache pattern - suitable for a routine review and a management plan."},
          "outcome_self_mild": {"type": "outcome", "key": "outcome_self_mild", "category": "self_management", "safetyNetMessageKey": "headache.self_mild", "clinicianReviewRequired": false, "rationale": "Mild, non-red-flag headache - self-care and monitoring appropriate."},
          "outcome_routine_moderate": {"type": "outcome", "key": "outcome_routine_moderate", "category": "routine", "safetyNetMessageKey": "headache.routine_moderate", "clinicianReviewRequired": false, "rationale": "Moderate, non-red-flag headache affecting daily activity - suitable for a routine appointment."},
          "outcome_urgent_severe": {"type": "outcome", "key": "outcome_urgent_severe", "category": "urgent", "safetyNetMessageKey": "headache.urgent_severe", "clinicianReviewRequired": true, "rationale": "Severe pain without a clear non-urgent explanation from the questions asked - routed to prompt review."}
        },
        "fallbackOutcome": {"type": "outcome", "key": "fallback", "category": "urgent", "safetyNetMessageKey": "generic.fallback_review", "clinicianReviewRequired": true, "rationale": "Triage graph reached an unexpected state - routed to human review as a safety default."}
      },
      {
        "key": "chest_pain",
        "label": "Chest pain",
        "knownAssociatedSymptoms": ["breathlessness", "sweating", "arm_or_jaw_pain", "nausea_vomiting", "fainting"],
        "knownTriggers": ["recent_injury"],
        "knownHistory": ["known_heart_disease", "diabetes", "hypertension"],
        "redFlagScreen": [
          {"key": "chest_pain.cardiac_pattern", "label": "Chest pain with breathlessness, sweating, or arm/jaw pain", "category": "emergency", "rule": {"anyAssociatedSymptom": ["breathlessness", "sweating", "arm_or_jaw_pain"], "minSeverity": 6}},
          {"key": "chest_pain.sudden_severe_tearing", "label": "Sudden, severe chest pain", "category": "emergency", "rule": {"onset": "sudden", "minSeverity": 8}},
          {"key": "chest_pain.syncope", "label": "Chest pain with fainting", "category": "emergency", "rule": {"anyAssociatedSymptom": ["fainting"]}},
          {"key": "chest_pain.known_cardiac_history", "label": "Chest pain in a patient with known heart disease", "category": "emergency", "rule": {"anyHistory": ["known_heart_disease"], "minSeverity": 5}}
        ],
        "startNodeKey": "reproducible_check",
        "nodes": {
          "reproducible_check": {"type": "question", "kind": "boolean", "key": "reproducible_check", "prompt": "Does the pain get worse when you press on your chest, or when you move or breathe deeply?", "onYes": "msk_duration_check", "onNo": "exertion_check"},
          "exertion_check": {"type": "question", "kind": "boolean", "key": "exertion_check", "prompt": "Does the pain come on with exercise or exertion, and ease with rest?", "onYes": "outcome_urgent_exertional", "onNo": "duration_check"},
          "msk_duration_check": {"type": "question", "kind": "boolean", "key": "msk_duration_check", "prompt": "Has this been going on for more than a day without getting worse?", "onYes": "outcome_self_msk", "onNo": "outcome_routine_msk"},
          "duration_check": {"type": "question", "kind": "choice", "key": "duration_check", "prompt": "How long has the pain lasted?", "options": [
            {"value": "under_1_hour", "label": "Less than an hour", "next": "outcome_urgent_new"},
            {"value": "longer", "label": "A few hours or longer", "next": "outcome_routine_general"}
          ]},
          "outcome_urgent_exertional": {"type": "outcome", "key": "outcome_urgent_exertional", "category": "urgent", "safetyNetMessageKey": "chest_pain.urgent_exertional", "clinicianReviewRequired": false, "rationale": "Exertional chest pain pattern - needs prompt cardiac assessment."},
          "outcome_self_msk": {"type": "outcome", "key": "outcome_self_msk", "category": "self_management", "safetyNetMessageKey": "chest_pain.self_msk", "clinicianReviewRequired": false, "rationale": "Reproducible, stable, non-red-flag chest wall pain - self-care appropriate."},
          "outcome_routine_msk": {"type": "outcome", "key": "outcome_routine_msk", "category": "routine", "safetyNetMessageKey": "chest_pain.routine_msk", "clinicianReviewRequired": false, "rationale": "Reproducible chest wall pain, new or changing - suitable for a routine appointment."},
          "outcome_urgent_new": {"type": "outcome", "key": "outcome_urgent_new", "category": "urgent", "safetyNetMessageKey": "chest_pain.urgent_new", "clinicianReviewRequired": true, "rationale": "New, non-exertional, non-reproducible chest pain under an hour old - genuinely ambiguous, routed to review."},
          "outcome_routine_general": {"type": "outcome", "key": "outcome_routine_general", "category": "routine", "safetyNetMessageKey": "chest_pain.routine_general", "clinicianReviewRequired": false, "rationale": "Non-red-flag chest pain lasting several hours or more - suitable for a routine appointment."}
        },
        "fallbackOutcome": {"type": "outcome", "key": "fallback", "category": "urgent", "safetyNetMessageKey": "generic.fallback_review", "clinicianReviewRequired": true, "rationale": "Triage graph reached an unexpected state - routed to human review as a safety default."}
      },
      {
        "key": "breathlessness",
        "label": "Breathlessness",
        "knownAssociatedSymptoms": ["chest_pain", "cannot_complete_sentences", "leg_swelling_one_sided", "wheeze"],
        "knownTriggers": [],
        "knownHistory": ["asthma", "copd", "heart_failure"],
        "redFlagScreen": [
          {"key": "breathlessness.severe_sudden", "label": "Sudden, severe breathlessness at rest", "category": "emergency", "rule": {"onset": "sudden", "minSeverity": 8}},
          {"key": "breathlessness.spo2_low", "label": "Low oxygen saturation", "category": "emergency", "rule": {"measurementBelow": {"key": "spo2_pct", "value": 92}}},
          {"key": "breathlessness.chest_pain", "label": "Breathlessness with chest pain", "category": "emergency", "rule": {"anyAssociatedSymptom": ["chest_pain"]}},
          {"key": "breathlessness.cannot_complete_sentences", "label": "Too breathless to complete a sentence", "category": "emergency", "rule": {"anyAssociatedSymptom": ["cannot_complete_sentences"]}},
          {"key": "breathlessness.unilateral_leg_swelling", "label": "Breathlessness with one-sided leg swelling", "category": "urgent", "rule": {"anyAssociatedSymptom": ["leg_swelling_one_sided"]}}
        ],
        "startNodeKey": "exertion_only",
        "nodes": {
          "exertion_only": {"type": "question", "kind": "boolean", "key": "exertion_only", "prompt": "Does the breathlessness only happen with exercise or exertion, easing quickly with rest?", "onYes": "outcome_routine_exertional", "onNo": "worsening_over_days"},
          "worsening_over_days": {"type": "question", "kind": "boolean", "key": "worsening_over_days", "prompt": "Has it been steadily getting worse over the past few days?", "onYes": "outcome_urgent_worsening", "onNo": "outcome_self_mild"},
          "outcome_routine_exertional": {"type": "outcome", "key": "outcome_routine_exertional", "category": "routine", "safetyNetMessageKey": "breathlessness.routine_exertional", "clinicianReviewRequired": false, "rationale": "Breathlessness limited to exertion, easing with rest - suitable for a routine appointment."},
          "outcome_urgent_worsening": {"type": "outcome", "key": "outcome_urgent_worsening", "category": "urgent", "safetyNetMessageKey": "breathlessness.urgent_worsening", "clinicianReviewRequired": false, "rationale": "Progressively worsening breathlessness over days - needs prompt clinical assessment."},
          "outcome_self_mild": {"type": "outcome", "key": "outcome_self_mild", "category": "self_management", "safetyNetMessageKey": "breathlessness.self_mild", "clinicianReviewRequired": false, "rationale": "Mild, stable, non-red-flag breathlessness - self-care and monitoring appropriate."}
        },
        "fallbackOutcome": {"type": "outcome", "key": "fallback", "category": "urgent", "safetyNetMessageKey": "generic.fallback_review", "clinicianReviewRequired": true, "rationale": "Triage graph reached an unexpected state - routed to human review as a safety default."}
      },
      {
        "key": "fever",
        "label": "Fever",
        "knownAssociatedSymptoms": ["neck_stiffness", "non_blanching_rash", "breathlessness", "confusion", "seizure", "reduced_urine_output"],
        "knownTriggers": ["recent_travel"],
        "knownHistory": ["pregnant", "hiv_or_immunocompromised", "cancer_history"],
        "redFlagScreen": [
          {"key": "fever.meningitic_signs", "label": "Fever with neck stiffness", "category": "emergency", "rule": {"anyAssociatedSymptom": ["neck_stiffness"]}},
          {"key": "fever.non_blanching_rash", "label": "Fever with a rash that does not fade when pressed", "category": "emergency", "rule": {"anyAssociatedSymptom": ["non_blanching_rash"]}},
          {"key": "fever.breathlessness", "label": "Fever with significant breathlessness", "category": "emergency", "rule": {"anyAssociatedSymptom": ["breathlessness"], "minSeverity": 6}},
          {"key": "fever.confusion_or_seizure", "label": "Fever with confusion or a seizure", "category": "emergency", "rule": {"anyAssociatedSymptom": ["confusion", "seizure"]}},
          {"key": "fever.very_high_temperature", "label": "Very high temperature", "category": "emergency", "rule": {"measurementAtLeast": {"key": "temperature_c", "value": 40}}},
          {"key": "fever.immunocompromised", "label": "Fever in an immunocompromised or cancer patient", "category": "urgent", "rule": {"anyHistory": ["hiv_or_immunocompromised", "cancer_history"], "minSeverity": 5}},
          {"key": "fever.pregnant", "label": "Fever in pregnancy", "category": "urgent", "rule": {"anyHistory": ["pregnant"], "minSeverity": 5}},
          {"key": "fever.reduced_urine_output", "label": "Fever with reduced urine output", "category": "urgent", "rule": {"anyAssociatedSymptom": ["reduced_urine_output"]}}
        ],
        "startNodeKey": "duration_check",
        "nodes": {
          "duration_check": {"type": "question", "kind": "boolean", "key": "duration_check", "prompt": "Has the fever lasted more than 5 days, or does it keep coming back?", "onYes": "outcome_urgent_prolonged", "onNo": "hydration_check"},
          "hydration_check": {"type": "question", "kind": "boolean", "key": "hydration_check", "prompt": "Are you able to keep fluids down, and passing urine normally?", "onYes": "severity_check", "onNo": "outcome_urgent_dehydration"},
          "severity_check": {"type": "question", "kind": "choice", "key": "severity_check", "prompt": "How high does the fever feel, and how are you coping?", "options": [
            {"value": "mild", "label": "Mild - I can carry on close to normal", "next": "outcome_self_mild"},
            {"value": "moderate", "label": "Moderate - uncomfortable, need to rest", "next": "outcome_routine_moderate"},
            {"value": "high", "label": "High - shivering, very unwell", "next": "outcome_urgent_high"}
          ]},
          "outcome_urgent_prolonged": {"type": "outcome", "key": "outcome_urgent_prolonged", "category": "urgent", "safetyNetMessageKey": "fever.urgent_prolonged", "clinicianReviewRequired": true, "rationale": "Fever lasting more than 5 days or recurring - needs assessment to find a cause, including malaria testing where relevant."},
          "outcome_urgent_dehydration": {"type": "outcome", "key": "outcome_urgent_dehydration", "category": "urgent", "safetyNetMessageKey": "fever.urgent_dehydration", "clinicianReviewRequired": true, "rationale": "Unable to keep fluids down or reduced urine output alongside fever - dehydration risk, needs prompt assessment."},
          "outcome_self_mild": {"type": "outcome", "key": "outcome_self_mild", "category": "self_management", "safetyNetMessageKey": "fever.self_mild", "clinicianReviewRequired": false, "rationale": "Mild, non-red-flag fever, coping well and hydrated - self-care and monitoring appropriate."},
          "outcome_routine_moderate": {"type": "outcome", "key": "outcome_routine_moderate", "category": "routine", "safetyNetMessageKey": "fever.routine_moderate", "clinicianReviewRequired": false, "rationale": "Moderate, non-red-flag fever - suitable for a routine appointment if it does not settle."},
          "outcome_urgent_high": {"type": "outcome", "key": "outcome_urgent_high", "category": "urgent", "safetyNetMessageKey": "fever.urgent_high", "clinicianReviewRequired": true, "rationale": "High fever with significant systemic upset, no other explanation from the questions asked - routed to prompt review."}
        },
        "fallbackOutcome": {"type": "outcome", "key": "fallback", "category": "urgent", "safetyNetMessageKey": "generic.fallback_review", "clinicianReviewRequired": true, "rationale": "Triage graph reached an unexpected state - routed to human review as a safety default."}
      },
      {
        "key": "abdominal_pain",
        "label": "Abdominal pain",
        "knownAssociatedSymptoms": ["vomiting_blood", "blood_in_stool", "fainting", "rigid_abdomen", "fever"],
        "knownTriggers": ["recent_injury"],
        "knownHistory": ["pregnant", "known_ulcer", "previous_abdominal_surgery"],
        "redFlagScreen": [
          {"key": "abdominal_pain.rigid_abdomen", "label": "Rigid, board-like abdomen", "category": "emergency", "rule": {"anyAssociatedSymptom": ["rigid_abdomen"]}},
          {"key": "abdominal_pain.gi_bleeding", "label": "Vomiting blood or blood in the stool", "category": "emergency", "rule": {"anyAssociatedSymptom": ["vomiting_blood", "blood_in_stool"]}},
          {"key": "abdominal_pain.syncope", "label": "Abdominal pain with fainting", "category": "emergency", "rule": {"anyAssociatedSymptom": ["fainting"]}},
          {"key": "abdominal_pain.sudden_severe", "label": "Sudden, severe abdominal pain", "category": "emergency", "rule": {"onset": "sudden", "minSeverity": 8}},
          {"key": "abdominal_pain.pregnant_severe", "label": "Significant abdominal pain in pregnancy", "category": "emergency", "rule": {"anyHistory": ["pregnant"], "minSeverity": 6}},
          {"key": "abdominal_pain.recent_injury", "label": "Abdominal pain after a recent injury", "category": "emergency", "rule": {"anyTrigger": ["recent_injury"], "minSeverity": 6}}
        ],
        "startNodeKey": "duration_check",
        "nodes": {
          "duration_check": {"type": "question", "kind": "boolean", "key": "duration_check", "prompt": "Has this pain lasted more than 24 hours and been getting worse?", "onYes": "outcome_urgent_worsening", "onNo": "severity_check"},
          "severity_check": {"type": "question", "kind": "choice", "key": "severity_check", "prompt": "How would you describe the pain right now?", "options": [
            {"value": "mild", "label": "Mild - I can carry on as normal", "next": "outcome_self_mild"},
            {"value": "moderate", "label": "Moderate - it''s slowing me down", "next": "outcome_routine_moderate"},
            {"value": "severe", "label": "Severe - it''s hard to do anything", "next": "outcome_urgent_severe"}
          ]},
          "outcome_urgent_worsening": {"type": "outcome", "key": "outcome_urgent_worsening", "category": "urgent", "safetyNetMessageKey": "abdominal_pain.urgent_worsening", "clinicianReviewRequired": true, "rationale": "Pain lasting more than a day and getting worse - needs prompt clinical assessment."},
          "outcome_self_mild": {"type": "outcome", "key": "outcome_self_mild", "category": "self_management", "safetyNetMessageKey": "abdominal_pain.self_mild", "clinicianReviewRequired": false, "rationale": "Mild, non-red-flag abdominal pain - self-care and monitoring appropriate."},
          "outcome_routine_moderate": {"type": "outcome", "key": "outcome_routine_moderate", "category": "routine", "safetyNetMessageKey": "abdominal_pain.routine_moderate", "clinicianReviewRequired": false, "rationale": "Moderate, non-red-flag abdominal pain - suitable for a routine appointment."},
          "outcome_urgent_severe": {"type": "outcome", "key": "outcome_urgent_severe", "category": "urgent", "safetyNetMessageKey": "abdominal_pain.urgent_severe", "clinicianReviewRequired": true, "rationale": "Severe pain without a clear non-urgent explanation from the questions asked - routed to prompt review."}
        },
        "fallbackOutcome": {"type": "outcome", "key": "fallback", "category": "urgent", "safetyNetMessageKey": "generic.fallback_review", "clinicianReviewRequired": true, "rationale": "Triage graph reached an unexpected state - routed to human review as a safety default."}
      }
    ]
  }'::jsonb,
  'v2 - draft, unsigned. Adds fever and abdominal_pain to v1''s three pathways (headache, chest_pain, breathlessness), transcribed in the same style from widely-taught general-practice red-flag criteria. Not independently clinically reviewed. Flagging for Clinical Director review before sign-off (public.sign_triage_protocols) - see docs/SYMPTOM_TRIAGE_ENGINE_SPEC.md. Signing this retires v1 automatically (sign_triage_protocols deactivates every other version).',
  false
);

do $$
begin
  if (select count(*) from public.triage_protocols where version = 2) <> 1 then
    raise exception 'FAIL: expected exactly one v2 triage_protocols row';
  end if;
  if (select is_active from public.triage_protocols where version = 2) then
    raise exception 'FAIL: v2 triage_protocols must seed inactive (unsigned)';
  end if;
  if jsonb_array_length((select config -> 'pathways' from public.triage_protocols where version = 2)) <> 5 then
    raise exception 'FAIL: v2 triage_protocols must carry exactly 5 pathways (3 from v1 plus fever, abdominal_pain)';
  end if;
  -- v1 must be untouched: still the signed, active version if it was before this migration ran.
  if (select count(*) from public.triage_protocols where is_active) > 1 then
    raise exception 'FAIL: more than one active triage_protocols version - this migration must never itself activate anything';
  end if;
  raise notice 'PASS: triage_protocols v2 seeded as an unsigned, inactive draft with 5 pathways';
end $$;
