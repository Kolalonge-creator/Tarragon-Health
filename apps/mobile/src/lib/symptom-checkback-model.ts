import {
  checkbackDoorCategory,
  checkbackResultKey,
  floorForAnswer,
  type CheckbackAction,
  type SymptomCapture,
  type TriageCategory,
} from "@tarragon/symptom-triage-engine";
import type { MessageKey } from "@tarragon/i18n";

/**
 * S59c on the phone: the pure decisions behind the follow-up after a symptom check ("better, same or worse?"). The server decides and
 * records (the same database function the web uses); the phone shows an emergency AT ONCE when the on-device red-flag floor, re-run on the
 * original answers plus what is newly ticked, asks for one, and never replaces it with anything softer. No network, no storage, no model.
 */

/** True when the floor, on the original answers plus the newly ticked signs, asks for the emergency route. */
export function followUpIsEmergencyOnDevice(capture: SymptomCapture, newSigns: readonly string[]): boolean {
  return floorForAnswer(capture, newSigns) === "emergency";
}

export interface FollowUpResultView {
  messageKey: MessageKey;
  /** Say that the care team has been told (only when an alert or an emergency event really was raised). */
  told: boolean;
  /** Offer booking, a summary, messaging and labs (never for a plain "better"). */
  showDoors: boolean;
  doorCategory: TriageCategory;
  showSafetyNet: boolean;
}

export function followUpResultView(action: CheckbackAction, doctorAccess: boolean | null | undefined, raised: boolean): FollowUpResultView {
  return {
    messageKey: checkbackResultKey(action, doctorAccess ?? null) as MessageKey,
    told: raised && action !== "emergency",
    showDoors: action !== "close",
    doorCategory: checkbackDoorCategory(action),
    showSafetyNet: action !== "close" && action !== "emergency",
  };
}

/** Never let a softer answer replace an emergency already shown on the device. */
export function keepEmergency(shown: boolean, next: CheckbackAction | null): CheckbackAction | null {
  return shown ? "emergency" : next;
}
