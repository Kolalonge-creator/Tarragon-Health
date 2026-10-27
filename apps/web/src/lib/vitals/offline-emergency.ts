import {
  BP_CARE_V3,
  BP_CARE_V5,
  BP_CARE_V6,
  BP_CARE_V7,
  grade,
  type Condition,
  type Reading,
  type Rule,
  type RuleSet,
  type SymptomCode,
  type TriageInput,
  type TriageResult,
} from "@tarragon/clinical";
import { activeWording, type MessageKey } from "@tarragon/i18n";
import { classifyBpLevel } from "@/lib/rules/bp-classification";

/**
 * INV-06 on the web: emergency guidance with the network off (S85b).
 *
 * The phone grades a reading on the device with the bundled rule set (`apps/mobile/src/lib/triage-device.ts`, fallback `BP_CARE_V5`). This is
 * the web's copy of that decision, over the same pure engine and the same bundled rule set, run in the browser with no request of any kind
 * (no fetch, no model: INV-01). It never writes anything: offline the form still refuses to save, and the dialog says so.
 *
 * Never weaker than the server. The engine is the grade; on top of it the guidance also shows when
 *   - the engine asks the emergency-symptom question (a reading at or above the question line, which the web cannot ask), because showing the
 *     guidance is the safe error, exactly as `bpAckWebCode` already does online;
 *   - the web's own classifier says "emergency" (the same band the server trigger uses);
 *   - a ticked symptom is an emergency on its own (a red-flag symptom, rule BP-R1/BP-A6; a convulsion or loss of consciousness in pregnancy, BP-P6);
 *   - the engine grades the same facts red or asks for guidance when the person is PREGNANT OR POSTPARTUM (see below).
 * Over-triggering is the accepted failure here; a missed emergency is not.
 *
 * Pregnancy is unknown offline. The web has no pregnancy flag on the device, so it grades every reading twice with the same bundled engine:
 * once as an ordinary adult and once as pregnant (the postpartum rules read the same severe lines, `params.pregnancy`, so one pass covers both).
 * Either grade being red, or asking for emergency guidance, shows the guidance. No number is written here: the severe pregnancy lines, the
 * question line and every symptom group are read from the rule set's own `params` and rules.
 *
 * The words are the signed wording for the engine's own action code (EMG-001, or EMG-001L for a low reading with fainting, confusion or chest
 * pain) read through `activeWording`, never retyped here. The only text this file owns is about the SAVE ("not saved"), which is not clinical.
 */

/** The rule set bundled in the web app: the same draft the phone falls back to. */
export const OFFLINE_RULE_SET: RuleSet = BP_CARE_V5;

/**
 * Every blood pressure rule set the platform has shipped or drafted. Used ONLY to learn which symptoms any of them treats as an emergency, so the
 * ticks the web offers do not depend on which version is signed on the server today.
 */
export const SHIPPED_BP_RULE_SETS: readonly RuleSet[] = [BP_CARE_V3, BP_CARE_V5, BP_CARE_V6, BP_CARE_V7];

/** The standard personal target the phone uses when it has none cached. */
const FALLBACK_TARGET = { systolic: 135, diastolic: 85 } as const; // band-ok: fallback personal BP target when none is cached, same default the phone uses; not a triage band

// ---------------------------------------------------------------------------------------------------------------------------------------
// The symptoms offered, derived from the engine (never a hand list).
// ---------------------------------------------------------------------------------------------------------------------------------------

function walk(c: Condition, onGroup: (g: string) => void, onField: (f: string) => void): void {
  if ("all" in c) c.all.forEach((x) => walk(x, onGroup, onField));
  else if ("any" in c) c.any.forEach((x) => walk(x, onGroup, onField));
  else if ("not" in c) walk(c.not, onGroup, onField);
  else if ("symptomGroup" in c) onGroup(c.symptomGroup);
  else onField(c.field);
}

/** A rule that shows emergency guidance or grades red, for a blood pressure reading or a symptom report. */
function isEmergencyRule(r: Rule): boolean {
  if (r.result !== "grade") return false;
  if (!r.triggers.some((t) => t === "observation" || t === "symptom")) return false;
  return r.grade === "red" || r.actions.some((a) => a.kind === "show_emergency_guidance");
}

/** True when the rule can fire with no reading at all (it reads no reading, previous, average or recheck field). `obstetric` counts: pregnancy is unknown offline. */
function needsNoReading(r: Rule): boolean {
  let needs = false;
  walk(r.when, () => {}, (f) => {
    if (/^(reading|previous|avg|recheck)\./.test(f)) needs = true;
  });
  return !needs;
}

function groupsOf(rules: readonly Rule[], sets: readonly RuleSet[]): Set<string> {
  // The group names a rule references; the symptom codes come from the set that carries the rule.
  const out = new Set<string>();
  for (const set of sets) {
    for (const r of set.rules) {
      if (!rules.includes(r)) continue;
      walk(r.when, (g) => {
        for (const s of set.params.symptomGroups[g] ?? []) out.add(s);
      }, () => {});
    }
  }
  return out;
}

function derive(sets: readonly RuleSet[]): { offered: SymptomCode[]; alone: Set<string> } {
  const emergency = sets.flatMap((s) => s.rules.filter(isEmergencyRule));
  const offered = groupsOf(emergency, sets);
  const alone = groupsOf(emergency.filter(needsNoReading), sets);
  return { offered: [...offered] as SymptomCode[], alone };
}

const DERIVED = derive(SHIPPED_BP_RULE_SETS);

/**
 * Every symptom some shipped rule set treats as an emergency, alone or beside a reading (red-flag, low-pressure, pre-eclampsia and obstetric
 * emergency groups, plus the symptom-alone group of version 7). A test checks this against the groups themselves.
 */
export const OFFLINE_SYMPTOM_CANDIDATES: readonly SymptomCode[] = DERIVED.offered;

/**
 * Candidates the form does NOT offer, each with the reason. A candidate with no patient label cannot be shown (no clinical wording is invented
 * here), and it is recorded as a gap in docs/OPEN-QUESTIONS.md (OQ-S85B-2), not silently dropped.
 */
export const OFFLINE_SYMPTOMS_NOT_OFFERED: Readonly<Partial<Record<SymptomCode, string>>> = {
  epigastric_pain:
    "no patient-facing label exists anywhere in the catalogue (the phone's question list omits it too); it is an emergency only beside a raised reading in pregnancy (BP-P4), and awaits wording the CMO has approved",
};

/** The patient label for each symptom, reusing the catalogue keys that already exist (vitals.symptom.*; fainting has only its symptom.opt.* one). */
const LABEL_KEYS: Readonly<Partial<Record<SymptomCode, MessageKey>>> = {
  severe_headache: "vitals.symptom.severe_headache",
  chest_pain: "vitals.symptom.chest_pain",
  breathlessness: "vitals.symptom.breathlessness",
  visual_disturbance: "vitals.symptom.visual_disturbance",
  confusion: "vitals.symptom.confusion",
  weakness_or_numbness: "vitals.symptom.weakness_or_numbness",
  difficulty_speaking: "vitals.symptom.difficulty_speaking",
  back_pain: "vitals.symptom.back_pain",
  sudden_face_hand_swelling: "vitals.symptom.sudden_face_hand_swelling",
  convulsion: "vitals.symptom.convulsion",
  loss_of_consciousness: "vitals.symptom.loss_of_consciousness",
  fainting: "symptom.opt.fainting",
};

/** The symptom ticks the form offers while offline: every candidate that has a label and no recorded reason for being left out. */
export const OFFLINE_SYMPTOMS: readonly SymptomCode[] = OFFLINE_SYMPTOM_CANDIDATES.filter((s) => LABEL_KEYS[s] !== undefined && OFFLINE_SYMPTOMS_NOT_OFFERED[s] === undefined);
export type OfflineSymptom = SymptomCode;

export function offlineSymptomLabelKey(code: SymptomCode): MessageKey {
  const key = LABEL_KEYS[code];
  if (!key) throw new Error(`no patient label for symptom ${code}`);
  return key;
}

export function isOfflineSymptom(value: string): value is OfflineSymptom {
  return (OFFLINE_SYMPTOMS as readonly string[]).includes(value);
}

/** Symptoms that are an emergency with no reading at all (the web has no pregnancy flag, so the pregnancy-only ones count). */
const ALONE_SYMPTOMS: ReadonlySet<string> = DERIVED.alone;
export function isEmergencyAloneSymptom(value: string): boolean {
  return ALONE_SYMPTOMS.has(value);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// The grade.
// ---------------------------------------------------------------------------------------------------------------------------------------

export type OfflineGuidanceCode = "EMG-001" | "EMG-001L";
export type OfflineReason = "engine_red" | "question_line" | "crisis_band" | "symptom" | "pregnancy_unknown";

export interface OfflineEmergency {
  readonly emergency: boolean;
  readonly code: OfflineGuidanceCode | null;
  readonly reasons: readonly OfflineReason[];
}

export interface OfflineEmergencyInput {
  readonly systolic?: number | null;
  readonly diastolic?: number | null;
  readonly symptoms?: readonly string[];
  /** Injected for tests; defaults to the clock. */
  readonly nowMs?: number;
}

function guidanceCodeOf(result: TriageResult): OfflineGuidanceCode | null {
  for (const a of result.actions) {
    if (a.kind === "show_emergency_guidance") return a.code === "EMG-001L" ? "EMG-001L" : "EMG-001";
  }
  return null;
}

/** Red, or asking the person for emergency guidance (an amber rule that carries guidance, or a rejected reading with a red-flag symptom). */
function asksForGuidance(result: TriageResult): boolean {
  return guidanceCodeOf(result) !== null || (result.status === "graded" && result.grade === "red") || (result.status === "rejected" && result.redFlagSymptomPresent);
}

export function gradeOfflineEmergency(input: OfflineEmergencyInput): OfflineEmergency {
  const reasons: OfflineReason[] = [];
  let code: OfflineGuidanceCode | null = null;
  const symptoms = (input.symptoms ?? []).filter(isOfflineSymptom);
  if (symptoms.some(isEmergencyAloneSymptom)) reasons.push("symptom");

  const { systolic, diastolic } = input;
  if (typeof systolic === "number" && typeof diastolic === "number" && Number.isFinite(systolic) && Number.isFinite(diastolic)) {
    if (classifyBpLevel(systolic, diastolic) === "emergency") reasons.push("crisis_band");
    const now = new Date(input.nowMs ?? Date.now()).toISOString();
    const reading: Reading = { systolic, diastolic, takenAt: now };
    const base = {
      history: [],
      target: { ...FALLBACK_TARGET },
      pathway: { state: "self_guided" },
      ageYears: null,
      now,
    } as const;
    const inputFor = (pregnant: boolean, answered: boolean): TriageInput => ({
      ...base,
      pregnant,
      postpartum: false,
      trigger: { type: "observation", reading, symptoms: answered ? symptoms : [], symptomsAnswered: answered },
    });
    try {
      const ordinary = grade(inputFor(false, true), OFFLINE_RULE_SET);
      const pregnant = grade(inputFor(true, true), OFFLINE_RULE_SET);
      const ordinaryAsks = asksForGuidance(ordinary);
      if (ordinaryAsks) reasons.push("engine_red");
      // Pregnancy is unknown on the device: the same facts graded as pregnant (or postpartum) count too.
      if (asksForGuidance(pregnant)) reasons.push(ordinaryAsks ? "engine_red" : "pregnancy_unknown");
      code = guidanceCodeOf(ordinary) ?? guidanceCodeOf(pregnant);
      // A reading at or above the question line is graded only after the symptom question, which the web cannot ask: guidance is the safe error.
      if (grade(inputFor(false, false), OFFLINE_RULE_SET).status === "symptom_check_required") reasons.push("question_line");
    } catch {
      // The engine does not throw on a validated reading; if it ever did, the band check above still stands.
    }
  }
  if (reasons.length === 0) return { emergency: false, code: null, reasons: [] };
  return { emergency: true, code: code ?? "EMG-001", reasons: [...new Set(reasons)] };
}

/** The emergency wording in force for the engine's own code, read through the one gate every screen uses. */
export function offlineGuidanceWording(code: OfflineGuidanceCode = "EMG-001"): { title: string; body: string } {
  return activeWording(code);
}

/** Non-clinical words about the save. The reading is never claimed saved. */
export const OFFLINE_NOT_SAVED_TITLE = "Your reading has not been saved";
export const OFFLINE_NOT_SAVED_BODY =
  "You are offline, so nothing was sent to TarragonHealth. The numbers you typed are still in the form. When you are back online, press Save reading again.";

/**
 * The words when a reading WAS sent but nothing came back (a slow or dropped connection that still reads as online): we cannot say it was saved,
 * and we cannot say it was not. Non-clinical, and it never says anyone has seen the reading.
 */
export const OFFLINE_UNCONFIRMED_TITLE = "We could not confirm your reading was saved";
export const OFFLINE_UNCONFIRMED_BODY =
  "The connection is slow or has dropped, so we cannot tell whether TarragonHealth received it. Your numbers are still in the form. When the connection is back, check your recent readings before pressing Save reading again.";
