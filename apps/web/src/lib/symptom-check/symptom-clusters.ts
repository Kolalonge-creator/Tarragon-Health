/**
 * Symptom-to-test recommendation content. A short, pre-approved, clinician-
 * reviewable list — deliberately static (not DB-backed) so any change to
 * what gets suggested is a code-reviewed PR, same pattern as `SCREENINGS` in
 * `apps/web/_components/screening-journey.tsx`.
 *
 * This is triage/education, never diagnosis (CLAUDE.md: "every clinical
 * judgment is made by a doctor"). A symptom combination only ever produces a
 * test suggestion if it matches one of the curated clusters below; anything
 * else — including any DANGER_SYMPTOM_ID — falls back to "see a doctor."
 * A doctor-consult path is always offered alongside any test suggestion,
 * never only the test.
 */

export interface SymptomOption {
  id: string;
  label: string;
}

export interface SymptomCluster {
  id: string;
  /** Patient-facing name, e.g. "Possible thyroid imbalance." */
  name: string;
  /** Anchor symptoms for this cluster (a subset of SYMPTOM_OPTIONS' ids). */
  anchorSymptomIds: string[];
  /** How many of anchorSymptomIds must be selected for this cluster to match. */
  minMatches: number;
  /** Selecting any of these suppresses this cluster's suggestion outright. */
  excludeSymptomIds: string[];
  /** public.screen_types.code this cluster suggests. */
  screenTypeCode: string;
  /** One or two sentences explaining the suggestion, warm and non-alarming. */
  patientExplanation: string;
  /**
   * Free-text trigger phrases for matching this cluster inside an AI Coach
   * message. Deliberately distinct from DANGER_SYMPTOM_IDS' vocabulary —
   * see matchSymptomClustersFromText.
   */
  textTriggers: RegExp[];
}

/**
 * Selecting any of these suppresses every test suggestion, regardless of
 * other answers — the same red-flag vocabulary as
 * apps/web/src/lib/validation/symptoms.ts's SYMPTOM_TYPES plus a few
 * cluster-specific exclusions (fever, flank pain, blood in urine for UTI).
 * Anyone who selects one of these should see "see a doctor now," never a
 * test suggestion.
 */
export const DANGER_SYMPTOM_IDS = [
  "chest_pain",
  "severe_headache",
  "visual_disturbance",
  "confusion",
  "breathlessness_at_rest",
  "fever",
  "flank_pain",
  "blood_in_urine",
] as const;

export const SYMPTOM_OPTIONS: SymptomOption[] = [
  { id: "neck_swelling", label: "Swelling at the front of your neck" },
  { id: "heat_cold_intolerance", label: "Feeling unusually hot or cold compared to people around you" },
  { id: "palpitations", label: "A racing or pounding heartbeat" },
  { id: "unexplained_weight_change", label: "Losing or gaining weight without trying to" },
  { id: "increased_thirst", label: "Feeling thirsty much more than usual" },
  { id: "frequent_urination", label: "Needing to urinate more often than usual" },
  { id: "fatigue", label: "Ongoing tiredness that doesn't improve with rest" },
  { id: "blurred_vision", label: "Blurred vision" },
  { id: "pale_skin", label: "Noticeably pale skin or the inside of your lower eyelid" },
  { id: "breathlessness_on_exertion", label: "Getting short of breath with mild activity, like climbing stairs" },
  { id: "burning_urination", label: "A burning or stinging feeling when you urinate" },
  { id: "lower_abdomen_discomfort", label: "Mild discomfort in your lower abdomen" },
  // Danger options — always shown in the checklist, but selecting any of
  // these routes straight to "see a doctor now," never a test suggestion.
  { id: "chest_pain", label: "Chest pain or tightness" },
  { id: "severe_headache", label: "A sudden, severe headache" },
  { id: "visual_disturbance", label: "Sudden vision loss or double vision" },
  { id: "confusion", label: "Confusion or difficulty staying alert" },
  { id: "breathlessness_at_rest", label: "Shortness of breath even at rest" },
  { id: "fever", label: "A fever" },
  { id: "flank_pain", label: "Pain in your side or back, below the ribs" },
  { id: "blood_in_urine", label: "Blood in your urine" },
];

export const SYMPTOM_CLUSTERS: SymptomCluster[] = [
  {
    id: "thyroid",
    name: "Possible thyroid imbalance",
    anchorSymptomIds: ["neck_swelling", "heat_cold_intolerance", "palpitations", "unexplained_weight_change"],
    minMatches: 2,
    excludeSymptomIds: [],
    screenTypeCode: "tft",
    patientExplanation:
      "These can be signs your thyroid is working too hard or not hard enough. A thyroid function test (TSH, Free T4) is the usual first step to check.",
    textTriggers: [
      /swelling.{0,15}(front of|in).{0,10}(my )?(neck|throat)/i,
      /(neck|throat).{0,15}swelling/i,
      /(heat|cold) intoleran/i,
      /(always|constantly) (feel(ing)? )?(too )?(hot|cold)/i,
    ],
  },
  {
    id: "blood_sugar",
    name: "Possible blood-sugar imbalance",
    anchorSymptomIds: ["increased_thirst", "frequent_urination", "fatigue", "blurred_vision"],
    minMatches: 2,
    excludeSymptomIds: [],
    screenTypeCode: "hba1c",
    patientExplanation:
      "Feeling thirsty more than usual, urinating more often, tiredness, and blurred vision together are worth checking with a blood sugar test (HbA1c), one of the most common early signs of diabetes.",
    textTriggers: [
      /(always|so|really) thirsty/i,
      /(peeing|urinating).{0,15}(more|a lot|often)/i,
      /blurr(y|ed) vision/i,
    ],
  },
  {
    id: "anaemia",
    name: "Possible iron-deficiency anaemia",
    anchorSymptomIds: ["fatigue", "pale_skin", "breathlessness_on_exertion"],
    minMatches: 2,
    excludeSymptomIds: [],
    screenTypeCode: "fbc",
    patientExplanation:
      "Ongoing tiredness, looking pale, and getting breathless with mild activity can point to low iron levels. A full blood count (FBC) checks for this.",
    textTriggers: [/(always|so|really) tired/i, /(look|looking|feel) pale/i, /(short of breath|breathless).{0,20}(stairs|walking|mild)/i],
  },
  {
    id: "uti",
    name: "Possible urinary tract infection",
    anchorSymptomIds: ["burning_urination", "frequent_urination", "lower_abdomen_discomfort"],
    minMatches: 2,
    excludeSymptomIds: ["fever", "flank_pain", "blood_in_urine"],
    screenTypeCode: "urinalysis",
    patientExplanation:
      "Burning when you urinate, needing to go more often, and mild lower-abdomen discomfort are common signs of a urinary tract infection. A urinalysis is the usual way to confirm it.",
    textTriggers: [/burn(s|ing)?.{0,15}(when i|to) (pee|urinate)/i, /(pain|sting).{0,10}(peeing|urination)/i],
  },
];

/** True if selecting `selectedIds` should suppress every test suggestion. */
export function hasDangerSymptom(selectedIds: string[]): boolean {
  return selectedIds.some((id) => (DANGER_SYMPTOM_IDS as readonly string[]).includes(id));
}

export interface SymptomMatchResult {
  /** True if the patient selected any DANGER_SYMPTOM_IDS entry — when true,
   * `matched` is always empty and the caller should show "see a doctor now"
   * instead of rendering any test suggestion. */
  dangerFlag: boolean;
  matched: SymptomCluster[];
}

/**
 * Deterministic, pure matcher over a checkbox-style symptom selection.
 * Never infers a cluster from anything but an exact id match against
 * SYMPTOM_OPTIONS — no free text, no LLM involvement, so the same clinical
 * judgment is reproducible and reviewable.
 */
export function matchSymptomClusters(selectedIds: string[]): SymptomMatchResult {
  if (hasDangerSymptom(selectedIds)) {
    return { dangerFlag: true, matched: [] };
  }
  const selected = new Set(selectedIds);
  const matched = SYMPTOM_CLUSTERS.filter((cluster) => {
    if (cluster.excludeSymptomIds.some((id) => selected.has(id))) return false;
    const hits = cluster.anchorSymptomIds.filter((id) => selected.has(id)).length;
    return hits >= cluster.minMatches;
  });
  return { dangerFlag: false, matched };
}

/**
 * Free-text matcher for the AI Coach. Deliberately independent of
 * `detectEmergencyKeywords` (apps/web/src/lib/ai-coach/keyword-guardrail.ts)
 * — callers must only invoke this once a message has already been confirmed
 * non-emergency, both by the deterministic keyword guardrail and by the
 * LLM's own tier classification. This function itself never classifies
 * emergency vs. not; it only ever adds a test suggestion on top of an
 * already-safe turn.
 */
export function matchSymptomClustersFromText(text: string): SymptomCluster[] {
  return SYMPTOM_CLUSTERS.filter((cluster) => cluster.textTriggers.some((pattern) => pattern.test(text)));
}
