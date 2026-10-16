/**
 * The guideline basis for each rule of vitals_care_triage v1 (pulse, SpO2, temperature), shown to the Chief Medical Officer beside the rule on the sign-off
 * hub. Words only, no logic: the rule set itself is the governed object; this is what the CMO reads to judge it. Evidence tags: [G] guideline, [P] peer
 * reviewed, [V] vendor claim, [NV] not verified, [OLD] the platform's own older live classifier (the starting value, not independent evidence).
 *
 * A test (vitals-triage-basis.test.ts) fails when a rule in the bundled rule set has no entry here, or an entry names no rule.
 */
import { isDeepStrictEqual } from "node:util";
import { VITALS_CARE_V1 } from "@tarragon/clinical";

/** True when the stored rules equal the bundled ones (key order does not matter); the panel hides this build's text otherwise. */
export function rulesMatchBuild(storedRules: unknown): boolean {
  if (storedRules === null || typeof storedRules !== "object") return false;
  return isDeepStrictEqual(storedRules, JSON.parse(JSON.stringify(VITALS_CARE_V1)));
}

export type Citation = { id: string; label: string; tag: "G" | "P" | "V" | "NV" | "OLD" };

export const VITALS_CITATIONS: readonly Citation[] = [
  { id: "news2", label: "Royal College of Physicians, National Early Warning Score 2 (2017). Single-parameter points: pulse 3 at 40 or below and 131 or above, 2 at 111 to 130, 1 at 41 to 50 and 91 to 110; SpO2 scale 1: 3 at 91 or below, 2 at 92 to 93, 1 at 94 to 95; temperature 3 at 35.0 or below, 2 at 39.1 or above, 1 at 35.1 to 36.0 and 38.1 to 39.0. A single parameter scoring 3 calls for urgent clinical review. Designed for adults in hospital, not for a single home reading", tag: "G" },
  { id: "bts-o2", label: "British Thoracic Society guideline for oxygen use in adults in healthcare and emergency settings: target saturation 94 to 98 percent, 88 to 92 percent for people at risk of hypercapnic respiratory failure", tag: "G" },
  { id: "imci", label: "WHO Integrated Management of Childhood Illness: a temperature of 37.5 or above is fever in a young child; heart rate and breathing ranges are age specific", tag: "G" },
  { id: "old-sql", label: "The platform's own live classifiers private.classify_pulse_level, classify_spo2_level and classify_temperature_level (read 2026-10-16). These are the starting values; their original clinical basis was a draft awaiting Clinical Director sign-off, so they are a baseline for parity, not independent evidence", tag: "OLD" },
  { id: "nigeria", label: "No Nigerian national guideline for single-reading home vital sign thresholds was found. Not verified", tag: "NV" },
];

export type RuleBasis = { basis: string; citations: readonly string[]; judgement?: string };

const NEWS2_PULSE = "NEWS2 scores a heart rate of 40 or below, or 131 or above, as 3 (its highest single-parameter score). These bands are wider on the fast side (121 for same-day care, 150 for emergency) and a little wider on the slow side (39 and 35).";

export const VITALS_RULE_BASIS: Readonly<Record<string, RuleBasis>> = {
  "VT-PU1": { basis: "Severe slow (35 or below) or fast (150 or above) heart rate in a single reading, for everyone, paged. Deliberately extreme-value triage: a single logged number carries no rhythm information and this is not arrhythmia detection. " + NEWS2_PULSE, citations: ["old-sql", "news2"], judgement: "NEWS2 would score 40 and 131 as 3. The platform line is lower than the older ones in one direction only if you choose to move it. Confirm 35 and 150, or move them." },
  "VT-PU2": { basis: "Heart rate 36 to 39, or 121 to 149, in an adult: same-day care and a page. " + NEWS2_PULSE, citations: ["old-sql", "news2"], judgement: "121 pages the on-call clinician. Exercise, fever and anxiety all raise a heart rate; the older trigger accepted that. Confirm." },
  "VT-PU3": { basis: "Adult resting heart rate bands do not apply to children and young people, so under 18 a heart rate outside 50 to 100 is routed to a clinician (amber) instead of paged. The emergency band (VT-PU1) still applies to everyone.", citations: ["imci"], judgement: "NEW against the older trigger, which paged a child on the adult bands. The divergence report marks this as by design. Confirm the age line (18) and that a child at 130 should be reviewed rather than paged." },
  "VT-PU4": { basis: "Heart rate 40 to 49, or 101 to 120: review needed, one review task a week at most, not a page. NEWS2 gives 1 or 2 points in this range.", citations: ["old-sql", "news2"], judgement: "Due time 72 hours is the older amber alert's review time and is PROPOSED." },
  "VT-PU5": { basis: "Heart rate 50 to 100 and nothing above matched: reading saved.", citations: ["old-sql"] },
  "VT-OX1": { basis: "SpO2 under 90 percent is hypoxaemia needing emergency assessment, paged with the get-help-now message. NEWS2 scores 91 or below as 3, so this line is slightly less sensitive.", citations: ["old-sql", "news2", "bts-o2"], judgement: "A finger-clip reading can be wrong (cold hands, nail polish, movement); the wording tells the patient to go for care, not to wait for a second reading. Confirm 90, or move to 91 to match NEWS2." },
  "VT-OX2": { basis: "SpO2 90 to 92 percent: low oxygen, same-day care and a page. NEWS2 scores 92 to 93 as 2.", citations: ["old-sql", "news2", "bts-o2"], judgement: "A patient with chronic lung disease may run at 88 to 92 as their target; the clinician-set personal line only ever makes a reading MORE urgent (amber), it cannot lower a red. Decide how a known COPD patient with a target of 88 to 92 should be handled before wide use; today they would be paged at 92." },
  "VT-OX3": { basis: "SpO2 93 to 94 percent: below the usual target, review needed (one task a week). NEWS2 scores 94 to 95 as 1.", citations: ["old-sql", "news2", "bts-o2"] },
  "VT-OX4": { basis: "A clinician can set a higher amber line for one patient (patient_spo2_targets). A reading at or below it, above the population amber band, is amber. It can only turn a green into an amber, never touch a red.", citations: ["old-sql"] },
  "VT-OX5": { basis: "SpO2 95 percent or more and nothing above matched: reading saved.", citations: ["old-sql", "bts-o2"] },
  "VT-TE1": { basis: "Temperature 40.0 or above, or under 35.0: dangerously high or low, paged. NEWS2 scores 35.0 or below as 3 (this line, under 35.0, leaves out 35.0 itself).", citations: ["old-sql", "news2"], judgement: "Home thermometers vary and a skin reading can run low; an under-35.0 reading pages. Confirm, or consider requiring a repeat reading first." },
  "VT-TE2": { basis: "Temperature 39.0 to 39.9: high fever, same-day care and a page. NEWS2 scores 39.1 or above as 2.", citations: ["old-sql", "news2"], judgement: "Fever is common and often a malaria or other infection in this setting; same-day care is the safe direction. Confirm that a page (not a task) is wanted at 39.0." },
  "VT-TE3": { basis: "Temperature 38.0 to 38.9: fever, review needed (one task a week). NEWS2 scores 38.1 to 39.0 as 1.", citations: ["old-sql", "news2", "imci"] },
  "VT-TE4": { basis: "A clinician can set a lower amber line for one patient (patient_temperature_targets). A reading at or above it, below the population amber band, is amber. Never touches a red.", citations: ["old-sql"] },
  "VT-TE5": { basis: "Temperature 35.0 to 37.9 and nothing above matched: reading saved.", citations: ["old-sql"] },
};

export const VITALS_OPEN_POINTS: readonly string[] = [
  "Only manual and Bluetooth readings are graded. A wearable streams a heart rate every few minutes and syncs old readings in bulk, so those stay on the older triggers alone. Decide whether, and how, wearable readings should be graded (a stale value in a bulk sync should probably not page).",
  "Single readings only, with no symptoms. A heart rate of 110 with chest pain is handled by the symptom red flags, not here; this rule set does not combine a reading with a symptom or with other readings (an early-warning score does, and was deliberately not built).",
  "The older triggers keep running beside this rule set until the two are shown to agree (the vitals divergence report). After you sign, a dangerous reading is paged by both unless the unified red-event paging is also switched on; with it on, the two fold into one page for the same reading.",
  "A value outside the physically possible range (for example a temperature of 3.6 for 36.6) is rejected as a typo and stored nothing. The older trigger would page it. The divergence report lists such readings as 'no shadow result'.",
  "The amber review task type (amber_vitals_review) needs your confirmation before these rules can be signed.",
  "No patient screen shows a vitals grade yet. The wording below is unsigned and not in the app catalogue; signing the rules does not by itself show a patient anything new.",
];

export const VITALS_SIGNING_NOTE =
  "Signing is the Chief Medical Officer's own clinical act and is never done for you by the system. Until you sign, pulse, SpO2 and temperature readings are graded in shadow only: nothing new is paged and no task is opened from them, and the older alerts keep running unchanged.";
