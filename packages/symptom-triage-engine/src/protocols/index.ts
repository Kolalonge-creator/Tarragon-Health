/**
 * Seed pathway data (spec §37.7 example: "Headache"; extended here with
 * chest pain and breathlessness).
 *
 * IMPORTANT - this is the same v1/draft/unsigned discipline as
 * `escalation_slas` and `alert_rules`: these three pathways are a faithful
 * transcription of widely-taught general-practice red-flag criteria (the
 * same class of criteria already reflected elsewhere in this codebase -
 * `symptoms`'s low-threshold red-flag list, `condition_protocols`'s
 * WHO-sourced hypertension escalation criteria for BP ≥180/110 with
 * symptoms). They are NOT a substitute for Clinical Director sign-off -
 * see the `triage_protocols` migration header. Do not extend the pathway
 * count without the same review discipline; three pathways is a
 * deliberately small, reviewable seed, not a target coverage list.
 *
 * This module is exported for tests and for generating the DB seed
 * (`supabase/migrations/*_triage_protocols.sql`'s jsonb config is a
 * hand-transcription of this exact shape - keep them in sync if you edit
 * either).
 */
import type { PresentingComplaintProtocol, TriageProtocolConfig } from "../types/index";

export const TRIAGE_PROTOCOL_CONFIG_VERSION = 1;

const HEADACHE: PresentingComplaintProtocol = {
  key: "headache",
  label: "Headache",
  knownAssociatedSymptoms: [
    "fever",
    "neck_stiffness",
    "visual_disturbance",
    "vision_loss",
    "weakness_or_numbness",
    "confusion",
    "nausea_vomiting",
  ],
  knownTriggers: ["head_injury_recent", "straining_coughing_or_sex"],
  knownHistory: ["pregnant", "hiv_or_immunocompromised", "cancer_history", "anticoagulant_use"],
  redFlagScreen: [
    {
      key: "headache.thunderclap_onset",
      label: "Sudden, severe (thunderclap) headache",
      category: "emergency",
      rule: { onset: "sudden", minSeverity: 8 },
    },
    {
      key: "headache.neuro_deficit",
      label: "Headache with new weakness, numbness or confusion",
      category: "emergency",
      rule: { anyAssociatedSymptom: ["weakness_or_numbness", "confusion"] },
    },
    {
      key: "headache.meningitic_signs",
      label: "Headache with fever and neck stiffness",
      category: "emergency",
      rule: { allAssociatedSymptoms: ["neck_stiffness", "fever"] },
    },
    {
      key: "headache.vision_loss",
      label: "Headache with loss of vision",
      category: "emergency",
      rule: { anyAssociatedSymptom: ["vision_loss"] },
    },
    {
      key: "headache.recent_head_injury",
      label: "Headache after a recent head injury",
      category: "emergency",
      rule: { anyTrigger: ["head_injury_recent"], minSeverity: 6 },
    },
    {
      key: "headache.immunocompromised_new_severe",
      label: "New severe headache in an immunocompromised or cancer patient",
      category: "urgent",
      rule: { anyHistory: ["hiv_or_immunocompromised", "cancer_history"], minSeverity: 6 },
    },
    {
      key: "headache.pregnancy_severe",
      label: "Severe headache in pregnancy",
      category: "urgent",
      rule: { anyHistory: ["pregnant"], minSeverity: 6 },
    },
  ],
  startNodeKey: "duration_check",
  nodes: {
    duration_check: {
      type: "question",
      kind: "boolean",
      key: "duration_check",
      prompt: "Has this headache lasted more than 3 days, or is it a pattern you've never had before?",
      onYes: "worsening_check",
      onNo: "frequency_check",
    },
    worsening_check: {
      type: "question",
      kind: "boolean",
      key: "worsening_check",
      prompt: "Is it getting worse day by day, or waking you up from sleep?",
      onYes: "outcome_urgent_worsening",
      onNo: "frequency_check",
    },
    frequency_check: {
      type: "question",
      kind: "boolean",
      key: "frequency_check",
      prompt: "Do you get headaches like this often - more than 10 days a month?",
      onYes: "outcome_routine_frequent",
      onNo: "severity_check",
    },
    severity_check: {
      type: "question",
      kind: "choice",
      key: "severity_check",
      prompt: "How would you describe the pain right now?",
      options: [
        { value: "mild", label: "Mild - I can carry on as normal", next: "outcome_self_mild" },
        { value: "moderate", label: "Moderate - it's slowing me down", next: "outcome_routine_moderate" },
        { value: "severe", label: "Severe - it's hard to do anything", next: "outcome_urgent_severe" },
      ],
    },
    outcome_urgent_worsening: {
      type: "outcome",
      key: "outcome_urgent_worsening",
      category: "urgent",
      safetyNetMessageKey: "headache.urgent_worsening",
      clinicianReviewRequired: false,
      rationale: "Progressive pattern or waking from sleep - needs prompt clinical assessment to rule out a secondary cause.",
    },
    outcome_routine_frequent: {
      type: "outcome",
      key: "outcome_routine_frequent",
      category: "routine",
      safetyNetMessageKey: "headache.routine_frequent",
      clinicianReviewRequired: false,
      rationale: "Frequent headache pattern - suitable for a routine review and a management plan.",
    },
    outcome_self_mild: {
      type: "outcome",
      key: "outcome_self_mild",
      category: "self_management",
      safetyNetMessageKey: "headache.self_mild",
      clinicianReviewRequired: false,
      rationale: "Mild, non-red-flag headache - self-care and monitoring appropriate.",
    },
    outcome_routine_moderate: {
      type: "outcome",
      key: "outcome_routine_moderate",
      category: "routine",
      safetyNetMessageKey: "headache.routine_moderate",
      clinicianReviewRequired: false,
      rationale: "Moderate, non-red-flag headache affecting daily activity - suitable for a routine appointment.",
    },
    outcome_urgent_severe: {
      type: "outcome",
      key: "outcome_urgent_severe",
      category: "urgent",
      safetyNetMessageKey: "headache.urgent_severe",
      clinicianReviewRequired: true,
      rationale: "Severe pain without a clear non-urgent explanation from the questions asked - routed to prompt review.",
    },
  },
  fallbackOutcome: {
    type: "outcome",
    key: "fallback",
    category: "urgent",
    safetyNetMessageKey: "generic.fallback_review",
    clinicianReviewRequired: true,
    rationale: "Triage graph reached an unexpected state - routed to human review as a safety default.",
  },
};

const CHEST_PAIN: PresentingComplaintProtocol = {
  key: "chest_pain",
  label: "Chest pain",
  knownAssociatedSymptoms: ["breathlessness", "sweating", "arm_or_jaw_pain", "nausea_vomiting", "fainting"],
  knownTriggers: ["recent_injury"],
  knownHistory: ["known_heart_disease", "diabetes", "hypertension"],
  redFlagScreen: [
    {
      key: "chest_pain.cardiac_pattern",
      label: "Chest pain with breathlessness, sweating, or arm/jaw pain",
      category: "emergency",
      rule: { anyAssociatedSymptom: ["breathlessness", "sweating", "arm_or_jaw_pain"], minSeverity: 6 },
    },
    {
      key: "chest_pain.sudden_severe_tearing",
      label: "Sudden, severe chest pain",
      category: "emergency",
      rule: { onset: "sudden", minSeverity: 8 },
    },
    {
      key: "chest_pain.syncope",
      label: "Chest pain with fainting",
      category: "emergency",
      rule: { anyAssociatedSymptom: ["fainting"] },
    },
    {
      key: "chest_pain.known_cardiac_history",
      label: "Chest pain in a patient with known heart disease",
      category: "emergency",
      rule: { anyHistory: ["known_heart_disease"], minSeverity: 5 },
    },
  ],
  startNodeKey: "reproducible_check",
  nodes: {
    reproducible_check: {
      type: "question",
      kind: "boolean",
      key: "reproducible_check",
      prompt: "Does the pain get worse when you press on your chest, or when you move or breathe deeply?",
      onYes: "msk_duration_check",
      onNo: "exertion_check",
    },
    exertion_check: {
      type: "question",
      kind: "boolean",
      key: "exertion_check",
      prompt: "Does the pain come on with exercise or exertion, and ease with rest?",
      onYes: "outcome_urgent_exertional",
      onNo: "duration_check",
    },
    msk_duration_check: {
      type: "question",
      kind: "boolean",
      key: "msk_duration_check",
      prompt: "Has this been going on for more than a day without getting worse?",
      onYes: "outcome_self_msk",
      onNo: "outcome_routine_msk",
    },
    duration_check: {
      type: "question",
      kind: "choice",
      key: "duration_check",
      prompt: "How long has the pain lasted?",
      options: [
        { value: "under_1_hour", label: "Less than an hour", next: "outcome_urgent_new" },
        { value: "longer", label: "A few hours or longer", next: "outcome_routine_general" },
      ],
    },
    outcome_urgent_exertional: {
      type: "outcome",
      key: "outcome_urgent_exertional",
      category: "urgent",
      safetyNetMessageKey: "chest_pain.urgent_exertional",
      clinicianReviewRequired: false,
      rationale: "Exertional chest pain pattern - needs prompt cardiac assessment.",
    },
    outcome_self_msk: {
      type: "outcome",
      key: "outcome_self_msk",
      category: "self_management",
      safetyNetMessageKey: "chest_pain.self_msk",
      clinicianReviewRequired: false,
      rationale: "Reproducible, stable, non-red-flag chest wall pain - self-care appropriate.",
    },
    outcome_routine_msk: {
      type: "outcome",
      key: "outcome_routine_msk",
      category: "routine",
      safetyNetMessageKey: "chest_pain.routine_msk",
      clinicianReviewRequired: false,
      rationale: "Reproducible chest wall pain, new or changing - suitable for a routine appointment.",
    },
    outcome_urgent_new: {
      type: "outcome",
      key: "outcome_urgent_new",
      category: "urgent",
      safetyNetMessageKey: "chest_pain.urgent_new",
      clinicianReviewRequired: true,
      rationale: "New, non-exertional, non-reproducible chest pain under an hour old - genuinely ambiguous, routed to review.",
    },
    outcome_routine_general: {
      type: "outcome",
      key: "outcome_routine_general",
      category: "routine",
      safetyNetMessageKey: "chest_pain.routine_general",
      clinicianReviewRequired: false,
      rationale: "Non-red-flag chest pain lasting several hours or more - suitable for a routine appointment.",
    },
  },
  fallbackOutcome: {
    type: "outcome",
    key: "fallback",
    category: "urgent",
    safetyNetMessageKey: "generic.fallback_review",
    clinicianReviewRequired: true,
    rationale: "Triage graph reached an unexpected state - routed to human review as a safety default.",
  },
};

const BREATHLESSNESS: PresentingComplaintProtocol = {
  key: "breathlessness",
  label: "Breathlessness",
  knownAssociatedSymptoms: ["chest_pain", "cannot_complete_sentences", "leg_swelling_one_sided", "wheeze"],
  knownTriggers: [],
  knownHistory: ["asthma", "copd", "heart_failure"],
  redFlagScreen: [
    {
      key: "breathlessness.severe_sudden",
      label: "Sudden, severe breathlessness at rest",
      category: "emergency",
      rule: { onset: "sudden", minSeverity: 8 },
    },
    {
      key: "breathlessness.spo2_low",
      label: "Low oxygen saturation",
      category: "emergency",
      rule: { measurementBelow: { key: "spo2_pct", value: 92 } },
    },
    {
      key: "breathlessness.chest_pain",
      label: "Breathlessness with chest pain",
      category: "emergency",
      rule: { anyAssociatedSymptom: ["chest_pain"] },
    },
    {
      key: "breathlessness.cannot_complete_sentences",
      label: "Too breathless to complete a sentence",
      category: "emergency",
      rule: { anyAssociatedSymptom: ["cannot_complete_sentences"] },
    },
    {
      key: "breathlessness.unilateral_leg_swelling",
      label: "Breathlessness with one-sided leg swelling",
      category: "urgent",
      rule: { anyAssociatedSymptom: ["leg_swelling_one_sided"] },
    },
  ],
  startNodeKey: "exertion_only",
  nodes: {
    exertion_only: {
      type: "question",
      kind: "boolean",
      key: "exertion_only",
      prompt: "Does the breathlessness only happen with exercise or exertion, easing quickly with rest?",
      onYes: "outcome_routine_exertional",
      onNo: "worsening_over_days",
    },
    worsening_over_days: {
      type: "question",
      kind: "boolean",
      key: "worsening_over_days",
      prompt: "Has it been steadily getting worse over the past few days?",
      onYes: "outcome_urgent_worsening",
      onNo: "outcome_self_mild",
    },
    outcome_routine_exertional: {
      type: "outcome",
      key: "outcome_routine_exertional",
      category: "routine",
      safetyNetMessageKey: "breathlessness.routine_exertional",
      clinicianReviewRequired: false,
      rationale: "Breathlessness limited to exertion, easing with rest - suitable for a routine appointment.",
    },
    outcome_urgent_worsening: {
      type: "outcome",
      key: "outcome_urgent_worsening",
      category: "urgent",
      safetyNetMessageKey: "breathlessness.urgent_worsening",
      clinicianReviewRequired: false,
      rationale: "Progressively worsening breathlessness over days - needs prompt clinical assessment.",
    },
    outcome_self_mild: {
      type: "outcome",
      key: "outcome_self_mild",
      category: "self_management",
      safetyNetMessageKey: "breathlessness.self_mild",
      clinicianReviewRequired: false,
      rationale: "Mild, stable, non-red-flag breathlessness - self-care and monitoring appropriate.",
    },
  },
  fallbackOutcome: {
    type: "outcome",
    key: "fallback",
    category: "urgent",
    safetyNetMessageKey: "generic.fallback_review",
    clinicianReviewRequired: true,
    rationale: "Triage graph reached an unexpected state - routed to human review as a safety default.",
  },
};

export const SEED_PATHWAYS: readonly PresentingComplaintProtocol[] = [HEADACHE, CHEST_PAIN, BREATHLESSNESS];

export const SEED_TRIAGE_PROTOCOL_CONFIG: TriageProtocolConfig = {
  version: TRIAGE_PROTOCOL_CONFIG_VERSION,
  pathways: [...SEED_PATHWAYS],
};
