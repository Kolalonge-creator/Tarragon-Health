import { screenRedFlagsOnDevice } from "./symptom-red-flags";
import type { SymptomCapture, TriageCategory } from "@tarragon/symptom-triage-engine";
import type { MessageKey } from "@tarragon/i18n";

/**
 * S59b: the pure decisions behind the mobile symptom checker screen, kept out of the component so they can be tested without a
 * renderer. No network, no storage, no model (INV-01). The device never decides a result LOWER than the server would: the on-device
 * red-flag floor runs first, and when the server cannot be reached the fallback is "needs prompt attention", never "all clear".
 */

export type CheckerView =
  | { kind: "loading" }
  | { kind: "closed" }
  | { kind: "blocked"; reason: "under_18" | "dob_required" }
  | { kind: "ready" };

/** What the screen shows before a check starts. A null state (no answer from the server) and any non-`ok` eligibility are closed. */
export function viewFor(state: { open: boolean; eligibility: "ok" | "under_18" | "dob_required" | "error" } | null | undefined): CheckerView {
  if (state === undefined) return { kind: "loading" };
  if (state === null || !state.open) return { kind: "closed" };
  if (state.eligibility === "under_18" || state.eligibility === "dob_required") return { kind: "blocked", reason: state.eligibility };
  if (state.eligibility !== "ok") return { kind: "closed" };
  return { kind: "ready" };
}

const CATEGORY_KEY: Record<TriageCategory, MessageKey> = {
  emergency: "symptom.mobile.category.emergency",
  urgent: "symptom.mobile.category.urgent",
  routine: "symptom.mobile.category.routine",
  self_management: "symptom.mobile.category.self_management",
};
export function categoryMessageKey(category: string): MessageKey {
  return CATEGORY_KEY[(category as TriageCategory) in CATEGORY_KEY ? (category as TriageCategory) : "urgent"];
}

export interface DeviceResult {
  category: TriageCategory;
  /** The result came from this phone alone (no server answer). */
  onDevice: true;
}

/**
 * The result when the server could not be reached or refused to answer: the on-device floor, and when it fired nothing the result is
 * "urgent" (an unclassifiable run is never reassurance, matching the server's degraded mode). An emergency on the floor stays one.
 */
export function offlineResult(capture: SymptomCapture): DeviceResult {
  const floor = screenRedFlagsOnDevice(capture);
  return { category: floor.category === "emergency" ? "emergency" : "urgent", onDevice: true };
}

/** Never let a later, softer answer replace an emergency the on-device floor already showed. */
export function keepMoreUrgent(shownEmergency: boolean, next: string): string {
  return shownEmergency ? "emergency" : next;
}
