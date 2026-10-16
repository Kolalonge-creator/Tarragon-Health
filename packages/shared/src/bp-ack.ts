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
 * and a patient screen does not quote it). The next step for a grade is the signed EMG/TRI wording the triage engine already chose; this file only
 * names the code for the web, which has no on-device engine.
 */

export type BpAckDelivery =
  | { readonly kind: "received" }
  | { readonly kind: "waiting" }
  | { readonly kind: "refused"; readonly supportCode: string | null }
  | { readonly kind: "not_saved" };

/** The shape of what the mobile save returns (apps/mobile/src/lib/bp-log.ts `LogBpResult`), as far as delivery is concerned. */
export interface BpSaveOutcome {
  readonly error?: string | undefined;
  readonly saved?: number | undefined;
  readonly syncedAll?: boolean | undefined;
  readonly remaining?: number | undefined;
  readonly rejectedSupportCodes?: readonly string[] | undefined;
}

/**
 * Delivery state after a save on the phone. Order matters and is the safe one: an error or nothing saved is never shown as saved; a refused row is
 * never shown as waiting (it will not retry); only "everything reached the server" is `received`.
 */
export function bpAckDelivery(r: BpSaveOutcome): BpAckDelivery {
  if (r.error || !r.saved) return { kind: "not_saved" };
  const rejected = r.rejectedSupportCodes ?? [];
  if (rejected.length > 0) return { kind: "refused", supportCode: rejected[0] ?? null };
  if (r.syncedAll === true) return { kind: "received" };
  return { kind: "waiting" };
}

export type BpAckLevel = "green" | "amber" | "red" | "emergency" | "unknown";

/**
 * The signed wording code the web shows beside "Received". The web has no on-device engine and no emergency-symptom question, so it never
 * invents guidance: within target says so (TRI-001), a little above says so (TRI-003), and a high or very high reading is told to rest and
 * measure again (TRI-005), which is the CMO-approved first step for both. The server's own emergency record (unchanged) still raises the full
 * safety net. Unknown says nothing beyond "Received".
 */
export type BpAckWebCode = "TRI-001" | "TRI-003" | "TRI-005";
export function bpAckWebCode(level: BpAckLevel): BpAckWebCode | null {
  switch (level) {
    case "green":
      return "TRI-001";
    case "amber":
      return "TRI-003";
    case "red":
    case "emergency":
      return "TRI-005";
    default:
      return null;
  }
}
