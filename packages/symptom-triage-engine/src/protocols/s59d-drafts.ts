/**
 * S59d DRAFT pathways: adult fever (with suspected malaria or typhoid), danger signs in pregnancy, complications of high blood
 * pressure and complications of diabetes.
 *
 * THESE ARE UNSIGNED DRAFTS FOR THE CHIEF MEDICAL OFFICER TO READ, EDIT AND SIGN. They are not in `SEED_PATHWAYS`, so the
 * bundled red-flag floor does not use them, and the database copy lives in an INACTIVE, UNSIGNED `triage_protocols` row. The
 * live loader (`selectLivePathway`) refuses any row that is not active and signed, so nothing here can reach a patient until
 * the CMO signs the version through `sign_triage_protocols`. No agent signs or activates anything.
 *
 * DESIGN RULES (same as the signed pathways and the paediatric drafts)
 *  - Red flags first, and a red flag is never argued down by a later question.
 *  - Nothing here lowers anything: the lowest category a red flag can name is `urgent`; no question-walk outcome in the three
 *    complication pathways or the pregnancy pathway is below `routine`, and no walk outcome anywhere is `emergency` (so a red
 *    flag that fires can only raise the result, which is what makes "more input never lowers urgency" true; see the property
 *    test in `s59d-drafts.test.ts`).
 *  - The adult fever pathway keeps EVERY rule key of the v2 draft (`fever.*`) and adds to them. Its one structural change from
 *    the v2 draft is that a fever with no malaria test can no longer end in self-care: self-care is reachable only after a
 *    negative test (see docs/research/S59d-pathway-coverage.md, question F2).
 *  - Numbers (blood pressure, glucose, temperature) are DATA inside the rules, not code, and every one is a CMO decision.
 *  - Measurement keys are the same names the record layer uses (`systolic`, `diastolic`, `glucose_mmol_l`, `temperature_c`).
 *  - Nothing here is a diagnosis. A pathway never says what the person has; it says what to do next.
 *
 * WHERE THE CONTENT COMES FROM. Sources and what could not be verified are in docs/research/S59d-pathway-coverage.md. In short:
 * WHO severe malaria features and the Nigerian national malaria and typhoid guidance for fever; WHO antenatal danger signs and
 * the CDC/ACOG urgent maternal warning signs for pregnancy; the ESC/ESH and ACC/AHA hypertensive emergency definitions plus
 * the FAST/BE-FAST stroke signs for blood pressure; the ADA hypoglycaemia levels, the ADA/EASD hyperglycaemic crises consensus
 * and the IWGDF/IDSA diabetic foot guidance for diabetes. Most were read through secondary summaries, not the primary text.
 *
 * The migration `*_s59d_draft_pathways_protocol.sql` carries a copy of this JSON; `s59d-drafts.test.ts` fails if they differ.
 */
import type { BooleanQuestionNode, ChoiceQuestionNode, OutcomeNode, PresentingComplaintProtocol, RedFlagRule, TriageCategory } from "../types/index";

const fallback: OutcomeNode = {
  type: "outcome",
  key: "fallback",
  category: "urgent",
  safetyNetMessageKey: "generic.fallback_review",
  clinicianReviewRequired: true,
  rationale: "Triage graph reached an unexpected state - routed to human review as a safety default.",
};

const yesNo = (key: string, prompt: string, onYes: string, onNo: string): BooleanQuestionNode => ({ type: "question", kind: "boolean", key, prompt, onYes, onNo });
const choice = (key: string, prompt: string, options: ChoiceQuestionNode["options"]): ChoiceQuestionNode => ({ type: "question", kind: "choice", key, prompt, options });
const outcome = (key: string, category: TriageCategory, messageKey: string, review: boolean, rationale: string): OutcomeNode => ({
  type: "outcome",
  key,
  category,
  safetyNetMessageKey: messageKey,
  clinicianReviewRequired: review,
  rationale,
});
const flag = (key: string, label: string, category: TriageCategory, rule: RedFlagRule["rule"]): RedFlagRule => ({ key, label, category, rule });

// ---------------------------------------------------------------------------
// (a) Adult fever, suspected malaria or typhoid. Same key as the v2 draft: every v2 rule key is kept.
// ---------------------------------------------------------------------------
const FEVER: PresentingComplaintProtocol = {
  key: "fever",
  label: "Fever",
  knownAssociatedSymptoms: [
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
    "blood_in_stool",
  ],
  knownTriggers: ["recent_travel"],
  knownHistory: ["pregnant", "hiv_or_immunocompromised", "cancer_history", "sickle_cell_disease"],
  redFlagScreen: [
    flag("fever.meningitic_signs", "Fever with neck stiffness", "emergency", { anyAssociatedSymptom: ["neck_stiffness"] }),
    flag("fever.non_blanching_rash", "Fever with a rash that does not fade when pressed", "emergency", { anyAssociatedSymptom: ["non_blanching_rash"] }),
    flag("fever.breathlessness", "Fever with significant breathlessness", "emergency", { anyAssociatedSymptom: ["breathlessness"], minSeverity: 6 }),
    flag("fever.confusion_or_seizure", "Fever with confusion or a seizure", "emergency", { anyAssociatedSymptom: ["confusion", "seizure"] }),
    flag("fever.very_high_temperature", "Very high temperature", "emergency", { measurementAtLeast: { key: "temperature_c", value: 40 } }),
    flag("fever.immunocompromised", "Fever in an immunocompromised or cancer patient", "urgent", { anyHistory: ["hiv_or_immunocompromised", "cancer_history"], minSeverity: 5 }),
    flag("fever.pregnant", "Fever in pregnancy", "urgent", { anyHistory: ["pregnant"], minSeverity: 5 }),
    flag("fever.reduced_urine_output", "Fever with reduced urine output", "urgent", { anyAssociatedSymptom: ["reduced_urine_output"] }),
    // S59d additions. WHO severe malaria features: too weak to sit or stand, abnormal bleeding, dark urine, jaundice, severe pallor.
    flag("fever.prostration", "Fever and too weak to sit up or stand without help", "emergency", { anyAssociatedSymptom: ["prostration"] }),
    flag("fever.abnormal_bleeding", "Fever with bleeding from the gums, nose or elsewhere", "emergency", { anyAssociatedSymptom: ["abnormal_bleeding"] }),
    flag("fever.dark_urine", "Fever with very dark or cola-coloured urine", "emergency", { anyAssociatedSymptom: ["dark_urine"] }),
    flag("fever.rigid_abdomen", "Fever with a hard, board-like belly", "emergency", { anyAssociatedSymptom: ["rigid_abdomen"] }),
    flag("fever.blood_in_stool", "Fever with blood in the stool or black stool", "emergency", { anyAssociatedSymptom: ["blood_in_stool"] }),
    flag("fever.jaundice", "Fever with yellow eyes or skin", "urgent", { anyAssociatedSymptom: ["jaundice"] }),
    flag("fever.severe_pallor", "Fever with a very pale look", "urgent", { anyAssociatedSymptom: ["severe_pallor"] }),
    flag("fever.persistent_vomiting", "Fever with vomiting that will not stop", "urgent", { anyAssociatedSymptom: ["persistent_vomiting"] }),
    flag("fever.breathlessness_any", "Fever with breathlessness", "urgent", { anyAssociatedSymptom: ["breathlessness"] }),
    flag("fever.pregnant_any", "Fever in pregnancy", "urgent", { anyHistory: ["pregnant"] }),
    flag("fever.sickle_cell", "Fever in someone with sickle cell disease", "urgent", { anyHistory: ["sickle_cell_disease"] }),
  ],
  startNodeKey: "duration_check",
  nodes: {
    duration_check: yesNo("duration_check", "Has the fever lasted 3 days or more, or does it keep coming back?", "outcome_urgent_prolonged", "hydration_check"),
    hydration_check: yesNo("hydration_check", "Are you able to keep fluids down, and passing urine normally?", "malaria_test_check", "outcome_urgent_dehydration"),
    malaria_test_check: yesNo("malaria_test_check", "Have you had a malaria test (a quick finger-prick test or a blood slide) during this illness?", "malaria_result_check", "outcome_routine_untested"),
    malaria_result_check: yesNo("malaria_result_check", "Was the malaria test positive?", "outcome_urgent_malaria_positive", "severity_check"),
    severity_check: choice("severity_check", "How high does the fever feel, and how are you coping?", [
      { value: "mild", label: "Mild - I can carry on close to normal", next: "outcome_self_mild" },
      { value: "moderate", label: "Moderate - uncomfortable, need to rest", next: "outcome_routine_moderate" },
      { value: "high", label: "High - shivering, very unwell", next: "outcome_urgent_high" },
    ]),
    outcome_urgent_prolonged: outcome("outcome_urgent_prolonged", "urgent", "fever.urgent_prolonged", true, "Fever lasting 3 days or more, or recurring - needs assessment to find a cause, including malaria and typhoid testing."),
    outcome_urgent_dehydration: outcome("outcome_urgent_dehydration", "urgent", "fever.urgent_dehydration", true, "Unable to keep fluids down or reduced urine output alongside fever - dehydration risk, needs prompt assessment."),
    outcome_routine_untested: outcome("outcome_routine_untested", "routine", "fever.routine_untested", false, "Fever with no malaria test yet - a test comes before any treatment, so the next step is to get tested."),
    outcome_urgent_malaria_positive: outcome("outcome_urgent_malaria_positive", "urgent", "fever.urgent_malaria_positive", true, "A positive malaria test needs a clinician to confirm the treatment and check for warning signs."),
    outcome_self_mild: outcome("outcome_self_mild", "self_management", "fever.self_mild", false, "Mild fever, malaria test negative, no red flag, coping and hydrated - self-care and monitoring appropriate."),
    outcome_routine_moderate: outcome("outcome_routine_moderate", "routine", "fever.routine_moderate", false, "Moderate, non-red-flag fever with a negative malaria test - suitable for a routine appointment if it does not settle."),
    outcome_urgent_high: outcome("outcome_urgent_high", "urgent", "fever.urgent_high", true, "High fever with significant systemic upset, malaria test negative, no other explanation from the questions asked - routed to prompt review."),
  },
  fallbackOutcome: fallback,
};

// ---------------------------------------------------------------------------
// (b) Danger signs in pregnancy
// ---------------------------------------------------------------------------
const PREGNANCY: PresentingComplaintProtocol = {
  key: "pregnancy_danger_signs",
  label: "A worry while pregnant",
  knownAssociatedSymptoms: [
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
    "fainting",
  ],
  knownTriggers: [],
  knownHistory: ["pregnant"],
  redFlagScreen: [
    flag("pregnancy_danger_signs.seizure", "A fit in pregnancy", "emergency", { anyAssociatedSymptom: ["seizure"] }),
    flag("pregnancy_danger_signs.heavy_bleeding", "Heavy bleeding from the vagina in pregnancy", "emergency", { anyAssociatedSymptom: ["heavy_vaginal_bleeding"] }),
    flag("pregnancy_danger_signs.headache_with_vision", "A headache with changes in how you see", "emergency", { allAssociatedSymptoms: ["headache", "visual_disturbance"] }),
    flag("pregnancy_danger_signs.vision_loss", "Losing your sight in pregnancy", "emergency", { anyAssociatedSymptom: ["vision_loss"] }),
    flag("pregnancy_danger_signs.severe_abdominal_pain", "Severe belly pain in pregnancy", "emergency", { anyAssociatedSymptom: ["severe_abdominal_pain"] }),
    flag("pregnancy_danger_signs.too_weak", "A fever and too weak to get out of bed", "emergency", { anyAssociatedSymptom: ["prostration"] }),
    flag("pregnancy_danger_signs.breathing", "Struggling to breathe, or chest pain, in pregnancy", "emergency", { anyAssociatedSymptom: ["breathlessness", "chest_pain"] }),
    flag("pregnancy_danger_signs.bleeding", "Bleeding from the vagina in pregnancy", "urgent", { anyAssociatedSymptom: ["vaginal_bleeding"] }),
    flag("pregnancy_danger_signs.reduced_movement", "The baby moving less than usual", "urgent", { anyAssociatedSymptom: ["reduced_fetal_movement"] }),
    flag("pregnancy_danger_signs.headache", "A headache in pregnancy", "urgent", { anyAssociatedSymptom: ["headache"] }),
    flag("pregnancy_danger_signs.vision_change", "A change in how you see in pregnancy", "urgent", { anyAssociatedSymptom: ["visual_disturbance"] }),
    flag("pregnancy_danger_signs.fever", "A fever in pregnancy", "urgent", { anyAssociatedSymptom: ["fever"] }),
    flag("pregnancy_danger_signs.leaking_fluid", "Fluid leaking from the vagina in pregnancy", "urgent", { anyAssociatedSymptom: ["leaking_fluid"] }),
    flag("pregnancy_danger_signs.swelling", "Swelling of the face or hands in pregnancy", "urgent", { anyAssociatedSymptom: ["face_or_hand_swelling"] }),
    flag("pregnancy_danger_signs.fainting", "Fainting in pregnancy", "urgent", { anyAssociatedSymptom: ["fainting"] }),
  ],
  startNodeKey: "recent_check",
  nodes: {
    recent_check: yesNo("recent_check", "Did this start, or get worse, in the last day?", "outcome_urgent_recent", "movement_check"),
    movement_check: yesNo("movement_check", "Is the baby moving as much as usual (if you are far enough along to feel it)?", "outcome_routine_pregnancy", "outcome_urgent_movement"),
    outcome_urgent_recent: outcome("outcome_urgent_recent", "urgent", "pregnancy_danger_signs.urgent_recent", true, "A new or worsening worry in pregnancy needs a clinician to look promptly."),
    outcome_urgent_movement: outcome("outcome_urgent_movement", "urgent", "pregnancy_danger_signs.urgent_movement", true, "Not feeling the baby move as usual needs to be checked promptly."),
    outcome_routine_pregnancy: outcome("outcome_routine_pregnancy", "routine", "pregnancy_danger_signs.routine", true, "A worry in pregnancy with no danger sign reported: a clinician reviews it. Never self-care."),
  },
  fallbackOutcome: fallback,
};

// ---------------------------------------------------------------------------
// (c) Complications of high blood pressure
// ---------------------------------------------------------------------------
const WARNING_WITH_HIGH_BP = ["severe_headache", "visual_disturbance", "breathlessness", "nosebleed_heavy", "palpitations", "fainting"];
const HYPERTENSION: PresentingComplaintProtocol = {
  key: "hypertension_complication",
  label: "High blood pressure and a warning sign",
  knownAssociatedSymptoms: [
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
    "fainting",
  ],
  knownTriggers: [],
  knownHistory: ["hypertension", "pregnant", "diabetes", "known_heart_disease"],
  redFlagScreen: [
    flag("hypertension_complication.chest_pain", "Chest pain with high blood pressure", "emergency", { anyAssociatedSymptom: ["chest_pain"] }),
    flag("hypertension_complication.stroke_signs", "New weakness, numbness, drooping face, trouble speaking, sight loss, confusion or a fit", "emergency", {
      anyAssociatedSymptom: ["weakness_or_numbness", "facial_droop", "speech_difficulty", "vision_loss", "confusion", "seizure"],
    }),
    flag("hypertension_complication.very_high_top_with_symptom", "A very high top number with a warning sign", "emergency", {
      measurementAtLeast: { key: "systolic", value: 180 },
      anyAssociatedSymptom: WARNING_WITH_HIGH_BP,
    }),
    flag("hypertension_complication.very_high_bottom_with_symptom", "A very high bottom number with a warning sign", "emergency", {
      measurementAtLeast: { key: "diastolic", value: 120 },
      anyAssociatedSymptom: WARNING_WITH_HIGH_BP,
    }),
    flag("hypertension_complication.breathless_lying_flat", "Breathless when lying flat", "emergency", { anyAssociatedSymptom: ["breathless_lying_flat"] }),
    flag("hypertension_complication.pregnant_warning", "High blood pressure in pregnancy with a headache or a change in sight", "emergency", {
      anyHistory: ["pregnant"],
      anyAssociatedSymptom: ["severe_headache", "visual_disturbance"],
    }),
    flag("hypertension_complication.very_high_top", "A very high top number", "urgent", { measurementAtLeast: { key: "systolic", value: 180 } }),
    flag("hypertension_complication.very_high_bottom", "A very high bottom number", "urgent", { measurementAtLeast: { key: "diastolic", value: 120 } }),
    flag("hypertension_complication.severe_headache", "A severe headache with high blood pressure", "urgent", { anyAssociatedSymptom: ["severe_headache"] }),
    flag("hypertension_complication.breathlessness", "Breathlessness with high blood pressure", "urgent", { anyAssociatedSymptom: ["breathlessness"] }),
    flag("hypertension_complication.pregnant", "High blood pressure while pregnant", "urgent", { anyHistory: ["pregnant"] }),
  ],
  startNodeKey: "higher_check",
  nodes: {
    higher_check: yesNo("higher_check", "Has your blood pressure been higher than usual in the last few days?", "missed_medicine_check", "outcome_routine_review"),
    missed_medicine_check: yesNo("missed_medicine_check", "Have you missed your blood pressure tablets for two days or more?", "outcome_routine_missed", "outcome_urgent_on_treatment"),
    outcome_routine_review: outcome("outcome_routine_review", "routine", "hypertension_complication.routine_review", true, "Blood pressure worry with no warning sign and no higher readings: a clinician reviews it."),
    outcome_routine_missed: outcome("outcome_routine_missed", "routine", "hypertension_complication.routine_missed", true, "Higher readings after missed tablets and no warning sign: a clinician reviews the plan."),
    outcome_urgent_on_treatment: outcome("outcome_urgent_on_treatment", "urgent", "hypertension_complication.urgent_on_treatment", true, "Higher readings despite taking tablets needs a prompt review of the treatment."),
  },
  fallbackOutcome: fallback,
};

// ---------------------------------------------------------------------------
// (d) Complications of diabetes
// ---------------------------------------------------------------------------
const DIABETES: PresentingComplaintProtocol = {
  key: "diabetes_complication",
  label: "Diabetes and a warning sign",
  knownAssociatedSymptoms: [
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
    "fever",
  ],
  knownTriggers: ["insulin_or_tablet_dose_mistake", "not_eaten", "recent_illness"],
  knownHistory: ["diabetes", "on_insulin", "pregnant"],
  redFlagScreen: [
    flag("diabetes_complication.neuro_signs", "Confusion, a fit, cannot be woken or cannot swallow with diabetes", "emergency", {
      anyAssociatedSymptom: ["confusion", "seizure", "unresponsive", "cannot_swallow"],
    }),
    flag("diabetes_complication.dka_breathing", "Deep fast breathing, fruity breath or being very drowsy with diabetes", "emergency", {
      anyAssociatedSymptom: ["deep_fast_breathing", "fruity_breath", "very_drowsy"],
    }),
    flag("diabetes_complication.vomiting_high_sugar", "Vomiting that will not stop with a high sugar reading", "emergency", {
      anyAssociatedSymptom: ["persistent_vomiting"],
      measurementAtLeast: { key: "glucose_mmol_l", value: 11 },
    }),
    flag("diabetes_complication.vomiting_ketones", "Vomiting that will not stop with ketones in the urine or blood", "emergency", {
      allAssociatedSymptoms: ["persistent_vomiting", "ketones_present"],
    }),
    flag("diabetes_complication.very_high_sugar", "A very high sugar reading", "emergency", { measurementAtLeast: { key: "glucose_mmol_l", value: 33.3 } }),
    flag("diabetes_complication.foot_dead_skin", "Black or dead skin on a foot", "emergency", { anyAssociatedSymptom: ["foot_black_or_dead_skin"] }),
    flag("diabetes_complication.foot_sore_fever", "A foot sore with a fever", "emergency", { allAssociatedSymptoms: ["foot_ulcer_or_blister", "fever"] }),
    flag("diabetes_complication.foot_hot_fever", "A red, hot, swollen foot with a fever", "emergency", { allAssociatedSymptoms: ["foot_red_hot_swollen", "fever"] }),
    flag("diabetes_complication.foot_discharge_fever", "A foot with discharge or a smell, and a fever", "emergency", { allAssociatedSymptoms: ["foot_discharge_or_smell", "fever"] }),
    flag("diabetes_complication.low_sugar", "A low sugar reading", "urgent", { measurementBelow: { key: "glucose_mmol_l", value: 3.8 } }),
    flag("diabetes_complication.low_sugar_signs", "Signs of a low sugar", "urgent", { anyAssociatedSymptom: ["hypo_warning_signs"] }),
    flag("diabetes_complication.ketones", "Ketones in the urine or blood", "urgent", { anyAssociatedSymptom: ["ketones_present"] }),
    flag("diabetes_complication.high_sugar_symptoms", "A high sugar reading with thirst or passing a lot of urine", "urgent", {
      measurementAtLeast: { key: "glucose_mmol_l", value: 20 },
      anyAssociatedSymptom: ["very_thirsty_passing_lots_of_urine"],
    }),
    flag("diabetes_complication.abdominal_pain", "Severe belly pain with diabetes", "urgent", { anyAssociatedSymptom: ["severe_abdominal_pain"] }),
    flag("diabetes_complication.vomiting", "Vomiting that will not stop with diabetes", "urgent", { anyAssociatedSymptom: ["persistent_vomiting"] }),
    flag("diabetes_complication.foot_problem", "A new foot sore, redness, swelling, discharge or smell", "urgent", {
      anyAssociatedSymptom: ["foot_ulcer_or_blister", "foot_red_hot_swollen", "foot_discharge_or_smell"],
    }),
    flag("diabetes_complication.dose_mistake", "A mix-up with insulin or tablets", "urgent", { anyTrigger: ["insulin_or_tablet_dose_mistake"] }),
  ],
  startNodeKey: "thirst_check",
  nodes: {
    thirst_check: yesNo("thirst_check", "In the last day, have you been much more thirsty than usual, passing a lot of urine, or feeling unusually tired?", "outcome_urgent_high_signs", "foot_check"),
    foot_check: yesNo("foot_check", "Is there any new sore, blister, colour change or swelling on a foot?", "outcome_urgent_foot", "low_check"),
    low_check: yesNo("low_check", "In the last week, have you had a low sugar episode (shaky, sweaty, confused) that you had to treat?", "outcome_routine_low", "outcome_routine_diabetes"),
    outcome_urgent_high_signs: outcome("outcome_urgent_high_signs", "urgent", "diabetes_complication.urgent_high_signs", true, "Thirst, passing a lot of urine or unusual tiredness with diabetes needs the sugar checked and a clinician to look promptly."),
    outcome_urgent_foot: outcome("outcome_urgent_foot", "urgent", "diabetes_complication.urgent_foot", true, "A new foot problem in diabetes needs to be looked at promptly, because infection can spread quickly."),
    outcome_routine_low: outcome("outcome_routine_low", "routine", "diabetes_complication.routine_low", true, "A treated low sugar episode this week: a clinician reviews the treatment plan."),
    outcome_routine_diabetes: outcome("outcome_routine_diabetes", "routine", "diabetes_complication.routine", true, "A diabetes worry with no warning sign reported: a clinician reviews it."),
  },
  fallbackOutcome: fallback,
};

export const S59D_DRAFT_PATHWAYS: readonly PresentingComplaintProtocol[] = [FEVER, PREGNANCY, HYPERTENSION, DIABETES];

/** Pathways the S59d draft adds or replaces, by key. `fever` replaces the v2 draft's `fever` (same key, every old rule key kept). */
export const S59D_PATHWAY_KEYS: readonly string[] = S59D_DRAFT_PATHWAYS.map((p) => p.key);

/** Every symptom, trigger and history key the S59d drafts use: each needs a patient-facing label before signing (tested in apps/web). */
export const S59D_DRAFT_VOCABULARY: readonly string[] = [
  ...new Set(S59D_DRAFT_PATHWAYS.flatMap((p) => [...p.knownAssociatedSymptoms, ...p.knownTriggers, ...p.knownHistory])),
];
