/**
 * S63 (Module 14, digital therapy programmes): the two PROPOSED configuration documents, written once here and mirrored by the
 * migration seeds (a test fails on drift). Both are DRAFT: nobody has signed either. The Chief Medical Officer confirms or replaces
 * them by publishing a higher version (CMO sign-off pack, Q13 to Q16 record the decisions that shaped the values marked CMO).
 *
 * Source of every value:
 *  - "CMO"      : a decision recorded in docs/plans/S61-S65-cmo-signoff-pack.md (Q13 to Q16).
 *  - "UNVERIFIED": a local Nigerian item the build added from the brief; it stays a draft until the CMO confirms it (Q16).
 *  - "BUILD"    : a number the build had to choose so the engine can run; the CMO must replace or confirm it.
 */

export type TherapyRoute = "crisis" | "same_day_clinician" | "medical_review_first" | "education_only";
export type TherapyRuleKind = "yes_no" | "score_at_least" | "score_below";

export interface TherapyExclusionRule {
  readonly code: string;
  readonly question: string;
  readonly kind: TherapyRuleKind;
  readonly threshold?: number;
  readonly route: TherapyRoute;
  /** A local item the CMO has not confirmed. Shown to the CMO as unverified; it still stops the programme (fail closed). */
  readonly unverified?: boolean;
}

export const THERAPY_PROGRAMME_CODES = [
  "panic_breathing",
  "pelvic_floor",
  "ibs_hypnotherapy",
  "cbt_i",
  "pain_back",
  "pain_neck",
  "pain_knee",
  "pain_hip",
  "low_mood",
  "stress",
  "anxiety",
  "pulmonary_rehab",
] as const;
export type TherapyProgrammeCode = (typeof THERAPY_PROGRAMME_CODES)[number];

const PAIN_RED_FLAGS: readonly TherapyExclusionRule[] = [
  { code: "saddle_numbness", question: "Do you have numbness or odd feelings around your genitals, buttocks or inner thighs (the saddle area)?", kind: "yes_no", route: "same_day_clinician" },
  { code: "bladder_or_bowel_change", question: "Have you noticed a new change in passing urine or opening your bowels, such as leaking or not being able to go?", kind: "yes_no", route: "same_day_clinician" },
  { code: "weakness_both_legs", question: "Do you have weakness in both legs?", kind: "yes_no", route: "same_day_clinician" },
  { code: "progressive_deficit", question: "Is weakness or numbness getting worse over days or weeks?", kind: "yes_no", route: "same_day_clinician" },
  { code: "recent_trauma", question: "Did this pain start after a fall, accident or injury?", kind: "yes_no", route: "same_day_clinician" },
  { code: "fever", question: "Do you have a fever, or have you felt feverish with this pain?", kind: "yes_no", route: "same_day_clinician" },
  { code: "unexplained_weight_loss", question: "Have you lost weight without trying in the last few months?", kind: "yes_no", route: "same_day_clinician" },
  { code: "cancer_history", question: "Have you ever been told you have or had cancer?", kind: "yes_no", route: "same_day_clinician" },
  { code: "night_pain", question: "Does the pain wake you at night or is it worst when you lie still?", kind: "yes_no", route: "same_day_clinician" },
  { code: "known_tb", question: "Have you been told you have TB (tuberculosis)?", kind: "yes_no", route: "same_day_clinician", unverified: true },
  { code: "sickle_cell_bone_pain", question: "Do you have sickle cell disease and is this a bone pain?", kind: "yes_no", route: "same_day_clinician", unverified: true },
  { code: "known_hiv", question: "Do you live with HIV?", kind: "yes_no", route: "same_day_clinician", unverified: true },
];

const MOOD_RULES: readonly TherapyExclusionRule[] = [
  // ANY item 9 answer above zero stops the programme (Q15). The card says go to the nearest hospital now and shows no number.
  { code: "phq9_item9", question: "PHQ-9 question 9: thoughts that you would be better off dead, or of hurting yourself (0 to 3)", kind: "score_at_least", threshold: 1, route: "crisis" },
  { code: "phq9_total", question: "PHQ-9 total score (0 to 27)", kind: "score_at_least", threshold: 15, route: "medical_review_first" },
  { code: "gad7_total", question: "GAD-7 total score (0 to 21)", kind: "score_at_least", threshold: 15, route: "medical_review_first" },
];

export const THERAPY_EXCLUSION_LISTS: Readonly<Record<TherapyProgrammeCode, readonly TherapyExclusionRule[]>> = {
  panic_breathing: [
    { code: "crisis_thoughts", question: "In the last two weeks, have you had thoughts of harming yourself or that you would be better off dead?", kind: "yes_no", route: "crisis" },
    { code: "chest_symptom", question: "Do you have, or have you recently had, chest pain, chest tightness, or a racing or uneven heartbeat?", kind: "yes_no", route: "same_day_clinician" },
    { code: "breathless_or_faint", question: "Are you short of breath at rest, or did you faint or nearly faint recently?", kind: "yes_no", route: "same_day_clinician" },
    { code: "first_time_panic", question: "Is this the first time you have had sudden waves of intense fear or panic?", kind: "yes_no", route: "medical_review_first" },
  ],
  pelvic_floor: [
    { code: "blood_in_urine", question: "Have you seen blood in your urine?", kind: "yes_no", route: "same_day_clinician" },
    { code: "urinary_retention", question: "Do you have trouble passing urine, a very weak stream, or a feeling that you cannot empty your bladder?", kind: "yes_no", route: "same_day_clinician" },
    { code: "pelvic_mass", question: "Have you felt a new lump or swelling in your pelvis or lower tummy?", kind: "yes_no", route: "same_day_clinician" },
    { code: "continuous_leakage", question: "Does urine leak all the time, day and night, rather than with a cough, a sneeze or a sudden urge?", kind: "yes_no", route: "same_day_clinician", unverified: true },
  ],
  ibs_hypnotherapy: [
    { code: "unexplained_weight_loss", question: "Have you lost weight without trying in the last few months?", kind: "yes_no", route: "same_day_clinician" },
    { code: "rectal_bleeding", question: "Have you had bleeding from your back passage?", kind: "yes_no", route: "same_day_clinician" },
    { code: "family_bowel_or_ovarian_cancer", question: "Has a close relative had cancer of the bowel or the ovary?", kind: "yes_no", route: "same_day_clinician" },
    { code: "anaemia_or_mass", question: "Have you been told you have anaemia (low blood), or have you felt a lump in your tummy or back passage?", kind: "yes_no", route: "same_day_clinician" },
    { code: "new_onset_over_50", question: "Are you over 50 and are these tummy symptoms new for you?", kind: "yes_no", route: "same_day_clinician", unverified: true },
    { code: "night_symptoms", question: "Do your tummy symptoms wake you from sleep?", kind: "yes_no", route: "same_day_clinician", unverified: true },
  ],
  cbt_i: [
    // Enter at ISI 15 or more; 8 to 14 gets education only (Q14).
    { code: "isi_total", question: "Insomnia Severity Index total score (0 to 28)", kind: "score_below", threshold: 15, route: "education_only" },
    { code: "bipolar_or_mania", question: "Have you ever been told you have bipolar disorder or had an episode of mania?", kind: "yes_no", route: "same_day_clinician" },
    { code: "psychosis", question: "Have you ever been told you have a psychotic illness, or had times of hearing or seeing things others do not?", kind: "yes_no", route: "same_day_clinician" },
    { code: "epilepsy_or_seizures", question: "Do you have epilepsy or have you had a seizure?", kind: "yes_no", route: "same_day_clinician" },
    { code: "parasomnia", question: "Do you sleepwalk, act out dreams, or have other unusual behaviours at night?", kind: "yes_no", route: "same_day_clinician" },
    { code: "drowsy_driving_or_safety_critical", question: "Do you drive or do safety-critical work and sometimes feel drowsy while doing it?", kind: "yes_no", route: "same_day_clinician" },
    { code: "pregnancy", question: "Are you pregnant?", kind: "yes_no", route: "same_day_clinician", unverified: true },
    { code: "alcohol_or_sedative_dependence", question: "Do you rely on alcohol, sleeping tablets or sedatives to sleep?", kind: "yes_no", route: "same_day_clinician", unverified: true },
    // Epworth 10 or more, or STOP-Bang 3 or more: medical review first (Q14).
    { code: "epworth_total", question: "Epworth Sleepiness Scale total score (0 to 24)", kind: "score_at_least", threshold: 10, route: "medical_review_first" },
    { code: "stopbang_total", question: "STOP-Bang total score (0 to 8)", kind: "score_at_least", threshold: 3, route: "medical_review_first" },
  ],
  pain_back: PAIN_RED_FLAGS,
  pain_neck: PAIN_RED_FLAGS,
  pain_knee: PAIN_RED_FLAGS,
  pain_hip: PAIN_RED_FLAGS,
  low_mood: MOOD_RULES,
  stress: MOOD_RULES,
  anxiety: MOOD_RULES,
  // Held until the COPD pathway exists (S61). No list means no entry: an empty list fails closed.
  pulmonary_rehab: [],
};

export interface TherapyWorseningRule {
  readonly rise_at_least?: number;
  readonly absolute_at_least?: number;
}

export interface TherapyProgrammeConfig {
  /** Due windows (minutes) for the clinician task each route raises. BUILD, the CMO confirms. */
  readonly route_due_minutes: { readonly same_day_clinician: number; readonly medical_review_first: number; readonly worsening_review: number };
  /** Outcome instruments asked at the checkpoint sessions; the first is the programme's primary score. */
  readonly instruments: Readonly<Record<TherapyProgrammeCode, readonly string[]>>;
  /** Session numbers at which scores are recorded. The first is the baseline. */
  readonly checkpoints: Readonly<Record<TherapyProgrammeCode, readonly number[]>>;
  readonly instrument_ranges: Readonly<Record<string, { readonly min: number; readonly max: number }>>;
  /** Worsening against baseline raises a clinician review. phq9 and gad7 values are CMO (Q15); the rest are BUILD. */
  readonly worsening: Readonly<Record<string, TherapyWorseningRule>>;
  /** Wave B settings the CMO decided (Q14). Held here so nothing is hard-coded when the CBT-I content is built. */
  readonly cbt_i: {
    readonly time_in_bed_floor_minutes: number;
    readonly sleep_restriction_requires_clinician_flag: boolean;
    readonly default_variant: readonly string[];
  };
  /** The pelvic floor dose (NICE NG123 style). BUILD, the CMO confirms. */
  readonly pelvic_floor: { readonly contractions_per_set: number; readonly sets_per_day: number; readonly minimum_months: number };
}

const SIX = [1, 3, 6] as const;

export const THERAPY_PROGRAMME_CONFIG: TherapyProgrammeConfig = {
  route_due_minutes: { same_day_clinician: 480, medical_review_first: 2880, worsening_review: 1440 },
  instruments: {
    panic_breathing: ["panic_episodes_week"],
    pelvic_floor: ["leakage_episodes_week"],
    ibs_hypnotherapy: ["ibs_symptom_0_10"],
    cbt_i: ["isi"],
    pain_back: ["pain_nrs"],
    pain_neck: ["pain_nrs"],
    pain_knee: ["pain_nrs"],
    pain_hip: ["pain_nrs"],
    low_mood: ["phq9", "gad7"],
    stress: ["phq9", "gad7"],
    anxiety: ["gad7", "phq9"],
    pulmonary_rehab: [],
  },
  checkpoints: {
    panic_breathing: SIX,
    pelvic_floor: [1, 4, 8, 12],
    ibs_hypnotherapy: SIX,
    cbt_i: SIX,
    pain_back: [1, 4, 8],
    pain_neck: [1, 4, 8],
    pain_knee: [1, 4, 8],
    pain_hip: [1, 4, 8],
    low_mood: SIX,
    stress: SIX,
    anxiety: SIX,
    pulmonary_rehab: [],
  },
  instrument_ranges: {
    phq9: { min: 0, max: 27 },
    gad7: { min: 0, max: 21 },
    isi: { min: 0, max: 28 },
    pain_nrs: { min: 0, max: 10 },
    panic_episodes_week: { min: 0, max: 99 },
    leakage_episodes_week: { min: 0, max: 99 },
    ibs_symptom_0_10: { min: 0, max: 10 },
  },
  worsening: {
    phq9: { rise_at_least: 5, absolute_at_least: 20 },
    gad7: { rise_at_least: 4 },
    isi: { rise_at_least: 4 },
    pain_nrs: { rise_at_least: 2 },
    panic_episodes_week: { rise_at_least: 3 },
    leakage_episodes_week: { rise_at_least: 3 },
    ibs_symptom_0_10: { rise_at_least: 2 },
  },
  cbt_i: {
    time_in_bed_floor_minutes: 330,
    sleep_restriction_requires_clinician_flag: true,
    default_variant: ["sleep_diary", "wind_down", "stimulus_control"],
  },
  pelvic_floor: { contractions_per_set: 8, sets_per_day: 3, minimum_months: 3 },
};
