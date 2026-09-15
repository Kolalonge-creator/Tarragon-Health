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
  /**
   * public.panel_bundles.code for the single-test bundle this cluster
   * suggests — resolved by exact bundle code, NOT by screen_types.code, since
   * a screen_type doesn't reliably map to one bundle 1:1 (e.g. the 2026-09
   * catalogue rebuild split "tft" into two component test_codes,
   * ["tsh","free_t4"], under the same single_tft bundle — matching by a
   * single screen_type code would have silently stopped resolving it).
   */
  panelBundleCode: string;
  /**
   * One or two sentences explaining the suggestion, warm and non-alarming.
   * Deliberately test/pattern-oriented, never a named diagnosis (e.g. "can
   * point to low iron levels", not "this is anaemia") — appendSymptomSuggestion
   * (ai-coach/graph.ts) appends `name` + this verbatim into an AI Coach
   * reply, and COACH_SYSTEM_PROMPT tells the model itself to never name a
   * condition. A cluster whose name/explanation names one anyway would
   * contradict that rule two paragraphs later in the same reply.
   */
  patientExplanation: string;
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
  // Yellowing of the skin/eyes (jaundice) is a step up in seriousness from
  // the rest of the liver cluster's anchor symptoms — it can mean anything
  // from a mild issue to acute liver failure or a blocked bile duct, so it
  // routes straight to "see a doctor," never a test suggestion, same as the
  // rest of this list.
  "jaundice",
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
  { id: "swelling_ankles_feet", label: "Swelling in your ankles or feet" },
  { id: "foamy_urine", label: "Foamy or bubbly urine" },
  { id: "reduced_urination", label: "Urinating noticeably less than usual" },
  { id: "dark_urine", label: "Unusually dark urine" },
  { id: "right_upper_abdomen_discomfort", label: "Discomfort on the upper right side of your abdomen" },
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
  { id: "jaundice", label: "Yellowing of your skin or the whites of your eyes" },
];

export const SYMPTOM_CLUSTERS: SymptomCluster[] = [
  {
    id: "thyroid",
    name: "Possible thyroid imbalance",
    anchorSymptomIds: ["neck_swelling", "heat_cold_intolerance", "palpitations", "unexplained_weight_change"],
    minMatches: 2,
    excludeSymptomIds: [],
    panelBundleCode: "single_tft",
    patientExplanation:
      "These can be signs your thyroid is working too hard or not hard enough. A thyroid function test (TSH, Free T4) is the usual first step to check.",
  },
  {
    id: "blood_sugar",
    name: "Possible blood-sugar imbalance",
    anchorSymptomIds: ["increased_thirst", "frequent_urination", "fatigue", "blurred_vision"],
    minMatches: 2,
    excludeSymptomIds: [],
    panelBundleCode: "single_hba1c",
    patientExplanation:
      "Feeling thirsty more than usual, urinating more often, tiredness, and blurred vision together are worth checking with a blood sugar test (HbA1c).",
  },
  {
    id: "anaemia",
    name: "Possible low iron levels",
    anchorSymptomIds: ["fatigue", "pale_skin", "breathlessness_on_exertion"],
    minMatches: 2,
    excludeSymptomIds: [],
    panelBundleCode: "single_fbc",
    patientExplanation:
      "Ongoing tiredness, looking pale, and getting breathless with mild activity can point to low iron levels. A full blood count (FBC) checks for this.",
  },
  {
    id: "uti",
    name: "Possible urinary tract irritation",
    anchorSymptomIds: ["burning_urination", "frequent_urination", "lower_abdomen_discomfort"],
    minMatches: 2,
    excludeSymptomIds: ["fever", "flank_pain", "blood_in_urine"],
    panelBundleCode: "single_urinalysis",
    patientExplanation:
      "Burning when you urinate, needing to go more often, and mild lower-abdomen discomfort together are worth checking with a urine test (urinalysis).",
  },
  {
    id: "kidney_concern",
    name: "Possible kidney concern",
    anchorSymptomIds: ["swelling_ankles_feet", "foamy_urine", "reduced_urination", "fatigue"],
    minMatches: 2,
    excludeSymptomIds: [],
    panelBundleCode: "single_kft",
    patientExplanation:
      "Swelling in your ankles or feet, foamy urine, and urinating less than usual together can point to how well your kidneys are filtering. A kidney function test (U&E, creatinine, eGFR) is the usual first step to check.",
  },
  {
    id: "liver_concern",
    name: "Possible liver concern",
    // Jaundice (yellowing of skin/eyes) is deliberately NOT an anchor symptom
    // here — it's a step up in seriousness from the rest of this cluster, so
    // it lives in DANGER_SYMPTOM_IDS instead and routes straight to a doctor,
    // never to this test suggestion.
    anchorSymptomIds: ["dark_urine", "right_upper_abdomen_discomfort", "fatigue"],
    minMatches: 2,
    excludeSymptomIds: ["jaundice"],
    panelBundleCode: "single_lft",
    patientExplanation:
      "Dark urine, discomfort on the upper right side of your abdomen, and ongoing tiredness together are worth checking with a liver function test.",
  },
];

/** The subset of `selectedIds` that are DANGER_SYMPTOM_IDS entries. */
export function selectedDangerSymptoms(selectedIds: string[]): string[] {
  return selectedIds.filter((id) => (DANGER_SYMPTOM_IDS as readonly string[]).includes(id));
}

/** True if selecting `selectedIds` should suppress every test suggestion. */
export function hasDangerSymptom(selectedIds: string[]): boolean {
  return selectedDangerSymptoms(selectedIds).length > 0;
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
 * Free-text patterns for the vocabulary that appears in a cluster's own
 * excludeSymptomIds (currently: fever/flank_pain/blood_in_urine for uti,
 * jaundice for liver_concern) — lets matchSymptomClustersFromText honour the
 * same per-cluster exclusion matchSymptomClusters already enforces on the
 * checkbox side. Deliberately NOT a general danger/emergency gate: a caller
 * must already have confirmed the message non-emergency via
 * detectEmergencyKeywords + the LLM's own tier classification before ever
 * calling matchSymptomClustersFromText (see its doc comment below), so this
 * only covers the narrower "this specific wording is a step up in
 * seriousness from this specific cluster's suggestion" case a cluster's own
 * excludeSymptomIds encodes — it does not suppress unrelated clusters.
 */
const EXCLUSION_TEXT_TRIGGERS: Partial<Record<string, RegExp[]>> = {
  fever: [/\bfever(ish)?\b/i],
  flank_pain: [/(flank|side|back) pain/i, /pain in (my |your )?(side|flank)/i],
  blood_in_urine: [/blood in (my |the |your )?urine/i, /urine.{0,10}(is |looks |was )?(bloody|red|pink)/i],
  jaundice: [
    /\bjaundice\b/i,
    /yellow(ing)?.{0,20}(skin|eyes|whites)/i,
    /(skin|eyes|whites).{0,20}yellow/i,
    /turning yellow/i,
  ],
};

/**
 * Free-text phrasing for individual anchor symptoms (SYMPTOM_OPTIONS ids),
 * used only by matchSymptomClustersFromText below to reconstruct which
 * anchor symptoms a chat message actually mentions — one entry per symptom
 * id, shared across every cluster that lists it in anchorSymptomIds, rather
 * than a separate per-cluster copy. An id absent here simply has no
 * chat-recognisable phrasing yet (palpitations, unexplained_weight_change,
 * lower_abdomen_discomfort) — those anchors only ever count toward a match
 * via the checkbox flow (matchSymptomClusters).
 */
const SYMPTOM_TEXT_TRIGGERS: Partial<Record<string, RegExp[]>> = {
  neck_swelling: [/swelling.{0,15}(front of|in).{0,10}(my )?(neck|throat)/i, /(neck|throat).{0,15}swelling/i],
  heat_cold_intolerance: [/(heat|cold) intoleran/i, /(always|constantly|keep) (feel(ing)? )?(too )?(hot|cold)/i],
  increased_thirst: [/(always|so|really) thirsty/i],
  frequent_urination: [/(peeing|urinating).{0,15}(more|a lot|often)/i],
  blurred_vision: [/blurr(y|ed) vision/i],
  fatigue: [/(always|so|really) tired/i],
  pale_skin: [/(look|looking|feel).{0,10}pale/i],
  breathlessness_on_exertion: [/(short of breath|breathless).{0,20}(stairs|walking|mild)/i],
  burning_urination: [/burn(s|ing)?.{0,15}(when i|to) (pee|urinate)/i, /(pain|sting).{0,10}(peeing|urination)/i],
  swelling_ankles_feet: [/swelling.{0,15}(ankle|feet|leg)/i, /(ankle|feet|leg).{0,15}swelling/i],
  foamy_urine: [/foamy.{0,20}urine/i, /urine.{0,20}foamy/i],
  reduced_urination: [/(peeing|urinating).{0,15}less/i],
  dark_urine: [/dark.{0,20}urine/i, /urine.{0,20}dark/i],
  right_upper_abdomen_discomfort: [/(pain|discomfort).{0,20}(upper right|right side).{0,15}(abdomen|stomach|belly)/i],
};

/**
 * Free-text matcher for the AI Coach. Deliberately independent of
 * `detectEmergencyKeywords` (apps/web/src/lib/ai-coach/keyword-guardrail.ts)
 * — callers must only invoke this once a message has already been confirmed
 * non-emergency, both by the deterministic keyword guardrail and by the
 * LLM's own tier classification. This function itself never classifies
 * emergency vs. not; it only ever adds a test suggestion on top of an
 * already-safe turn. It does, however, still honour each cluster's own
 * excludeSymptomIds via EXCLUSION_TEXT_TRIGGERS above, so wording like
 * "my skin looks yellow" never gets a liver-function-test suggestion
 * stapled onto it, matching the checkbox matcher's jaundice exclusion.
 *
 * Requires the same `minMatches` corroboration as the checkbox flow — at
 * least that many of a cluster's *distinct* anchorSymptomIds must each have
 * a SYMPTOM_TEXT_TRIGGERS hit, not just any one trigger anywhere. Before
 * 2026-09-14 this matched on any single trigger hit regardless of
 * minMatches, so one vague word (e.g. "I've been really tired") alone could
 * fire a cluster the checkbox flow would only suggest given two or more
 * corroborating symptoms — see the refuses_to_diagnose eval-case fix this
 * function was rewritten alongside for the reproduction.
 */
export function matchSymptomClustersFromText(text: string): SymptomCluster[] {
  const mentionedSymptomIds = new Set(
    Object.entries(SYMPTOM_TEXT_TRIGGERS)
      .filter(([, patterns]) => patterns!.some((pattern) => pattern.test(text)))
      .map(([id]) => id)
  );
  return SYMPTOM_CLUSTERS.filter((cluster) => {
    const hits = cluster.anchorSymptomIds.filter((id) => mentionedSymptomIds.has(id)).length;
    if (hits < cluster.minMatches) return false;
    return !cluster.excludeSymptomIds.some((id) =>
      (EXCLUSION_TEXT_TRIGGERS[id] ?? []).some((pattern) => pattern.test(text))
    );
  });
}
