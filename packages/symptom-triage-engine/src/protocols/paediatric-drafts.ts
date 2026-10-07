/**
 * DRAFT paediatric pathways (spec 12.6): fever, dehydration (with diarrhoea) and breathing in a child.
 *
 * THESE ARE UNSIGNED DRAFTS. They are not in `SEED_PATHWAYS`, so the bundled red-flag floor does not use them. They are inserted
 * into the database as an INACTIVE, UNSIGNED `triage_protocols` version (alongside the three signed adult pathways, so that
 * signing the version later would not drop them) and nothing makes them available to a patient until the Chief Medical Officer
 * signs that version through `sign_triage_protocols`. No agent signs or activates anything. The patient screen offers only the
 * pathways of the ACTIVE signed config.
 *
 * WHERE THE CLINICAL CONTENT COMES FROM. The red-flag criteria are a transcription of the widely taught IMCI general danger signs
 * (unable to drink or feed, vomits everything, convulsions, lethargic or unconscious) and the usual severe-illness signs for each
 * complaint, the same class of criteria the signed adult pathways were transcribed from. They have NOT been independently
 * clinically reviewed. Nothing here is a diagnosis: every outcome is "the safest next step", none is below `routine`, and every
 * outcome asks a human to look, because a child is never told "self-care" by a draft nobody has signed.
 *
 * A child's age is not tested against a number here. Whether the child is a young infant is a question the carer answers
 * (`infant_under_3_months`), so no age threshold lives in code; the CMO decides the wording, and any age band, when signing.
 *
 * The migration `*_s59_paediatric_draft_protocol.sql` carries a copy of this JSON; `paediatric-drafts.test.ts` fails if the two
 * differ.
 */
import type { OutcomeNode, PresentingComplaintProtocol } from "../types/index";

const fallback = (key: string): OutcomeNode => ({
  type: "outcome",
  key,
  category: "urgent",
  safetyNetMessageKey: "paediatric.fallback",
  clinicianReviewRequired: true,
  rationale: "The question graph reached a dead end: treated as needing a clinician to look, never as reassurance.",
});

const DANGER_SIGNS = ["convulsions", "unable_to_drink_or_feed", "vomits_everything", "lethargic_or_unconscious"];

const PAEDIATRIC_FEVER: PresentingComplaintProtocol = {
  key: "paediatric_fever",
  label: "Fever in a child",
  knownAssociatedSymptoms: [...DANGER_SIGNS, "stiff_neck", "rash_that_does_not_fade", "fast_breathing", "chest_indrawing"],
  knownTriggers: [],
  knownHistory: ["infant_under_3_months", "sickle_cell_disease", "hiv_or_immunocompromised"],
  redFlagScreen: [
    { key: "paediatric_fever.general_danger_sign", label: "Fever with a general danger sign", category: "emergency", rule: { anyAssociatedSymptom: DANGER_SIGNS } },
    { key: "paediatric_fever.meningeal_signs", label: "Fever with a stiff neck or a rash that does not fade", category: "emergency", rule: { anyAssociatedSymptom: ["stiff_neck", "rash_that_does_not_fade"] } },
    { key: "paediatric_fever.young_infant", label: "Fever in a very young infant", category: "emergency", rule: { anyHistory: ["infant_under_3_months"] } },
    { key: "paediatric_fever.breathing", label: "Fever with fast breathing or the chest pulling in", category: "urgent", rule: { anyAssociatedSymptom: ["fast_breathing", "chest_indrawing"] } },
    { key: "paediatric_fever.vulnerable_child", label: "Fever in a child with sickle cell disease or a weakened immune system", category: "urgent", rule: { anyHistory: ["sickle_cell_disease", "hiv_or_immunocompromised"] } },
  ],
  startNodeKey: "duration_check",
  nodes: {
    duration_check: { type: "question", kind: "boolean", key: "duration_check", prompt: "Has the fever lasted for more than a couple of days?", onYes: "outcome_urgent_prolonged", onNo: "drinking_check" },
    drinking_check: { type: "question", kind: "boolean", key: "drinking_check", prompt: "Is your child drinking and passing urine as usual?", onYes: "outcome_routine_fever", onNo: "outcome_urgent_not_drinking" },
    outcome_urgent_prolonged: { type: "outcome", key: "outcome_urgent_prolonged", category: "urgent", safetyNetMessageKey: "paediatric_fever.urgent_prolonged", clinicianReviewRequired: true, rationale: "A fever that has lasted for days in a child needs a clinician to look." },
    outcome_urgent_not_drinking: { type: "outcome", key: "outcome_urgent_not_drinking", category: "urgent", safetyNetMessageKey: "paediatric_fever.urgent_not_drinking", clinicianReviewRequired: true, rationale: "Fever with poor drinking or passing less urine in a child needs prompt assessment." },
    outcome_routine_fever: { type: "outcome", key: "outcome_routine_fever", category: "routine", safetyNetMessageKey: "paediatric_fever.routine", clinicianReviewRequired: true, rationale: "Recent fever in a child who is drinking and passing urine as usual: a clinician reviews it, no urgent sign was reported." },
  },
  fallbackOutcome: fallback("outcome_fallback"),
};

const PAEDIATRIC_DEHYDRATION: PresentingComplaintProtocol = {
  key: "paediatric_dehydration",
  label: "Diarrhoea or vomiting in a child",
  knownAssociatedSymptoms: [...DANGER_SIGNS, "sunken_eyes", "sunken_soft_spot", "no_tears", "very_few_wet_nappies", "skin_pinch_slow", "blood_in_stool"],
  knownTriggers: [],
  knownHistory: ["infant_under_3_months", "sickle_cell_disease"],
  redFlagScreen: [
    { key: "paediatric_dehydration.general_danger_sign", label: "Diarrhoea or vomiting with a general danger sign", category: "emergency", rule: { anyAssociatedSymptom: DANGER_SIGNS } },
    { key: "paediatric_dehydration.young_infant", label: "Diarrhoea or vomiting in a very young infant", category: "emergency", rule: { anyHistory: ["infant_under_3_months"] } },
    { key: "paediatric_dehydration.signs", label: "Signs of dehydration", category: "urgent", rule: { anyAssociatedSymptom: ["sunken_eyes", "sunken_soft_spot", "no_tears", "very_few_wet_nappies", "skin_pinch_slow"] } },
    { key: "paediatric_dehydration.blood", label: "Blood in the stool", category: "urgent", rule: { anyAssociatedSymptom: ["blood_in_stool"] } },
  ],
  startNodeKey: "drinking_check",
  nodes: {
    drinking_check: { type: "question", kind: "boolean", key: "drinking_check", prompt: "Is your child able to drink, and keeping the drink down?", onYes: "duration_check", onNo: "outcome_urgent_not_drinking" },
    duration_check: { type: "question", kind: "boolean", key: "duration_check", prompt: "Has it gone on for more than a day?", onYes: "outcome_urgent_prolonged", onNo: "outcome_routine_dehydration" },
    outcome_urgent_not_drinking: { type: "outcome", key: "outcome_urgent_not_drinking", category: "urgent", safetyNetMessageKey: "paediatric_dehydration.urgent_not_drinking", clinicianReviewRequired: true, rationale: "A child who cannot keep fluids down needs prompt assessment." },
    outcome_urgent_prolonged: { type: "outcome", key: "outcome_urgent_prolonged", category: "urgent", safetyNetMessageKey: "paediatric_dehydration.urgent_prolonged", clinicianReviewRequired: true, rationale: "Diarrhoea or vomiting that has gone on in a child needs a clinician to look." },
    outcome_routine_dehydration: { type: "outcome", key: "outcome_routine_dehydration", category: "routine", safetyNetMessageKey: "paediatric_dehydration.routine", clinicianReviewRequired: true, rationale: "Recent diarrhoea or vomiting in a child who is drinking: a clinician reviews it, no urgent sign was reported." },
  },
  fallbackOutcome: fallback("outcome_fallback"),
};

const PAEDIATRIC_BREATHING: PresentingComplaintProtocol = {
  key: "paediatric_breathing",
  label: "Breathing trouble in a child",
  knownAssociatedSymptoms: [...DANGER_SIGNS, "blue_lips", "chest_indrawing", "grunting", "stridor", "fast_breathing", "wheeze"],
  knownTriggers: ["choking_or_swallowed_object"],
  knownHistory: ["infant_under_3_months", "asthma", "sickle_cell_disease"],
  redFlagScreen: [
    { key: "paediatric_breathing.severe_signs", label: "Blue lips, grunting, the chest pulling in or a harsh noise on breathing in", category: "emergency", rule: { anyAssociatedSymptom: ["blue_lips", "chest_indrawing", "grunting", "stridor"] } },
    { key: "paediatric_breathing.general_danger_sign", label: "Breathing trouble with a general danger sign", category: "emergency", rule: { anyAssociatedSymptom: DANGER_SIGNS } },
    { key: "paediatric_breathing.choking", label: "Breathing trouble after choking or swallowing something", category: "emergency", rule: { anyTrigger: ["choking_or_swallowed_object"] } },
    { key: "paediatric_breathing.young_infant", label: "Breathing trouble in a very young infant", category: "emergency", rule: { anyHistory: ["infant_under_3_months"] } },
    { key: "paediatric_breathing.fast_or_wheeze", label: "Fast breathing or wheezing", category: "urgent", rule: { anyAssociatedSymptom: ["fast_breathing", "wheeze"] } },
  ],
  startNodeKey: "speech_check",
  nodes: {
    speech_check: { type: "question", kind: "boolean", key: "speech_check", prompt: "Is your child breathing comfortably when resting?", onYes: "outcome_routine_breathing", onNo: "outcome_urgent_not_comfortable" },
    outcome_urgent_not_comfortable: { type: "outcome", key: "outcome_urgent_not_comfortable", category: "urgent", safetyNetMessageKey: "paediatric_breathing.urgent", clinicianReviewRequired: true, rationale: "A child who is not breathing comfortably at rest needs prompt assessment." },
    outcome_routine_breathing: { type: "outcome", key: "outcome_routine_breathing", category: "routine", safetyNetMessageKey: "paediatric_breathing.routine", clinicianReviewRequired: true, rationale: "Breathing trouble reported, comfortable at rest and no urgent sign reported: a clinician reviews it." },
  },
  fallbackOutcome: fallback("outcome_fallback"),
};

export const PAEDIATRIC_DRAFT_PATHWAYS: readonly PresentingComplaintProtocol[] = [PAEDIATRIC_FEVER, PAEDIATRIC_DEHYDRATION, PAEDIATRIC_BREATHING];

/** Every symptom, trigger and history key the drafts use: each needs a patient-facing label before signing (tested in apps/web). */
export const PAEDIATRIC_DRAFT_VOCABULARY: readonly string[] = [
  ...new Set(PAEDIATRIC_DRAFT_PATHWAYS.flatMap((p) => [...p.knownAssociatedSymptoms, ...p.knownTriggers, ...p.knownHistory])),
];
