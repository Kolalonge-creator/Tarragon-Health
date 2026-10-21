/**
 * The acknowledgement a person sees straight after saving a blood pressure reading (docs/design/BP-immediate-acknowledgement.md).
 *
 * It says only what is true at that moment, in one of four states, and never anything a person has not done:
 *   - `received`   the server has stored it                       -> "Received by TarragonHealth."
 *   - `waiting`    saved on this phone, not sent yet (offline)    -> "Saved on this phone. It will send when you are back online."
 *   - `refused`    the server refused it; it stays on the phone   -> the existing support-code line
 *   - `not_saved`  nothing was saved                              -> the form's own error
 *
 * What it must NEVER say (a test scans the wording): that a doctor or the care team HAS reviewed or seen it (no review has happened; only a
 * null-gated ReviewedByDoctor record may say so), or how fast anyone will answer (`escalation_slas` is the only source of a response time,
 * and a patient screen does not quote it). The next step for a grade on the phone is the signed EMG/TRI wording the triage engine already chose;
 * this file only names the code for the web, which has no on-device engine.
 */

export type BpAckDelivery =
  | { readonly kind: "received" }
  | { readonly kind: "waiting" }
  | { readonly kind: "refused"; readonly supportCode: string | null }
  | { readonly kind: "not_saved" };

/**
 * What the phone knows about the blood pressure ROW itself, not the whole log: a pulse or symptom row that is slow or refused says nothing about
 * whether the blood pressure arrived. `sent` means the row has left the phone's outbox because the server accepted it.
 */
export type BpRowState = "sent" | "waiting" | "rejected";

export interface BpSaveOutcome {
  readonly error?: string | undefined;
  readonly saved?: number | undefined;
  /** The blood pressure row's own state; undefined when it cannot be found, which is treated as waiting, never as received. */
  readonly bpState?: BpRowState | undefined;
  readonly bpSupportCode?: string | null | undefined;
}

/**
 * Delivery state after a save on the phone. Order matters and is the safe one: an error or nothing saved is never shown as saved; a refused row is
 * never shown as waiting (it will not retry); only "the blood pressure row reached the server" is `received`, and an unknown state is `waiting`.
 */
export function bpAckDelivery(r: BpSaveOutcome): BpAckDelivery {
  if (r.error || !r.saved) return { kind: "not_saved" };
  if (r.bpState === "rejected") return { kind: "refused", supportCode: r.bpSupportCode ?? null };
  if (r.bpState === "sent") return { kind: "received" };
  return { kind: "waiting" };
}

/** The display band the web uses. A compile-time check in the web helper keeps this identical to the web classifier's own union. */
export type BpAckLevel = "green" | "amber" | "red" | "emergency" | "unknown";

/**
 * The signed wording code the web shows beside "Received". The web has no on-device engine, no emergency-symptom question and no knowledge of a
 * person's own target or pregnancy, so it never tells anyone they are within target or "a little above" (that would be false reassurance for a pregnant
 * person or someone with a lower target). It says only what is true for every adult: a high reading is rest and measure again (TRI-005), and a
 * crisis-range reading gets the signed emergency wording (EMG-001), the safe error where the web cannot ask the symptom question the phone asks first.
 * Anything else says only "Received".
 */
export type BpAckWebCode = "TRI-005" | "EMG-001";
export function bpAckWebCode(level: BpAckLevel): BpAckWebCode | null {
  switch (level) {
    case "red":
      return "TRI-005";
    case "emergency":
      return "EMG-001";
    default:
      return null;
  }
}
