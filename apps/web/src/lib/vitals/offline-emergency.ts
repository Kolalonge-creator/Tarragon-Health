import { BP_CARE_V5, grade, type Reading, type RuleSet, type SymptomCode, type TriageInput } from "@tarragon/clinical";
import { activeWording } from "@tarragon/i18n";
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
 *   - any emergency symptom is ticked (a red-flag symptom alone is an emergency, rule BP-R1).
 * Over-triggering is the accepted failure here; a missed emergency is not.
 *
 * The words are the EMG-001 wording read through `activeWording` (never retyped here). The only text this file owns is about the SAVE
 * ("not saved"), which is not clinical.
 */

/** The symptoms the form offers. Each is an engine SymptomCode and has a patient label in the i18n catalogue (`vitals.symptom.<code>`). */
export const OFFLINE_SYMPTOMS = ["chest_pain", "breathlessness", "severe_headache", "visual_disturbance", "confusion"] as const satisfies readonly SymptomCode[];
export type OfflineSymptom = (typeof OFFLINE_SYMPTOMS)[number];

export function isOfflineSymptom(value: string): value is OfflineSymptom {
  return (OFFLINE_SYMPTOMS as readonly string[]).includes(value);
}

/** The rule set bundled in the web app: the same draft the phone falls back to. */
export const OFFLINE_RULE_SET: RuleSet = BP_CARE_V5;

/** The standard personal target the phone uses when it has none cached. */
const FALLBACK_TARGET = { systolic: 135, diastolic: 85 } as const;

export type OfflineReason = "engine_red" | "question_line" | "crisis_band" | "symptom";

export interface OfflineEmergency {
  readonly emergency: boolean;
  readonly code: "EMG-001" | null;
  readonly reasons: readonly OfflineReason[];
}

export interface OfflineEmergencyInput {
  readonly systolic?: number | null;
  readonly diastolic?: number | null;
  readonly symptoms?: readonly string[];
  /** Injected for tests; defaults to the clock. */
  readonly nowMs?: number;
}

export function gradeOfflineEmergency(input: OfflineEmergencyInput): OfflineEmergency {
  const reasons: OfflineReason[] = [];
  const symptoms = (input.symptoms ?? []).filter(isOfflineSymptom);
  if (symptoms.length > 0) reasons.push("symptom");

  const { systolic, diastolic } = input;
  if (typeof systolic === "number" && typeof diastolic === "number" && Number.isFinite(systolic) && Number.isFinite(diastolic)) {
    if (classifyBpLevel(systolic, diastolic) === "emergency") reasons.push("crisis_band");
    const now = new Date(input.nowMs ?? Date.now()).toISOString();
    const reading: Reading = { systolic, diastolic, takenAt: now };
    const base = {
      history: [],
      target: { ...FALLBACK_TARGET },
      pathway: { state: "self_guided" },
      pregnant: false,
      postpartum: false,
      ageYears: null,
      now,
    } as const;
    try {
      const answered: TriageInput = { ...base, trigger: { type: "observation", reading, symptoms, symptomsAnswered: true } };
      const result = grade(answered, OFFLINE_RULE_SET);
      if (result.actions.some((a) => a.kind === "show_emergency_guidance") || (result.status === "graded" && result.grade === "red")) {
        reasons.push("engine_red");
      }
      // A reading at or above the question line is graded only after the symptom question, which the web cannot ask: guidance is the safe error.
      const unanswered: TriageInput = { ...base, trigger: { type: "observation", reading, symptoms: [], symptomsAnswered: false } };
      if (grade(unanswered, OFFLINE_RULE_SET).status === "symptom_check_required") reasons.push("question_line");
    } catch {
      // The engine does not throw on a validated reading; if it ever did, the band check above still stands.
    }
  }
  if (reasons.length === 0) return { emergency: false, code: null, reasons: [] };
  return { emergency: true, code: "EMG-001", reasons: [...new Set(reasons)] };
}

/** The emergency wording in force, read through the one gate every screen uses. */
export function offlineGuidanceWording(): { title: string; body: string } {
  return activeWording("EMG-001");
}

/** Non-clinical words about the save. The reading is never claimed saved. */
export const OFFLINE_NOT_SAVED_TITLE = "Your reading has not been saved";
export const OFFLINE_NOT_SAVED_BODY =
  "You are offline, so nothing was sent to TarragonHealth. The numbers you typed are still in the form. When you are back online, press Save reading again.";
