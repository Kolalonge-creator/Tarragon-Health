import { evaluateBundledRedFlags, type SymptomCapture, type TriageCategory } from "@tarragon/symptom-triage-engine";

/**
 * INV-06 (S60): the red-flag screen of the symptom checker runs ON THE DEVICE, from rules bundled with the app, so a person with
 * no signal still gets emergency guidance. There is no mobile symptom checker screen yet (the go-live guard `symptom_checker_enabled`
 * is off and a screen would need CMO-signed wording and a local-language review); this is the engine-free floor that screen, and
 * the existing symptom log, can call. It is pure: no network, no storage, no model (INV-01). It can only ever raise a result.
 */
export interface OnDeviceScreen {
  /** The most urgent category a fired red flag asks for, or null when none fired. */
  category: TriageCategory | null;
  /** Keys of the red flags that fired, for the audit trail the server writes when the device is next online. */
  fired: string[];
  /** Show the emergency guidance now, without waiting for anything. */
  showEmergencyGuidance: boolean;
}

export function screenRedFlagsOnDevice(capture: SymptomCapture): OnDeviceScreen {
  const r = evaluateBundledRedFlags(capture);
  return { category: r.topCategory, fired: r.fired.map((f) => f.key), showEmergencyGuidance: r.topCategory === "emergency" };
}
