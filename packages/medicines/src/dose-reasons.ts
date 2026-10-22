/**
 * Why a dose was not taken (item 5). One tap alongside taken. The list mirrors the PROPOSED config `medicines.dose_reasons`
 * (a test fails on drift) and the SQL function `private.is_private_dose_reason`.
 *
 * A private reason (ran out, cannot afford) is stored apart from the dose log. Only the person, someone acting for them and the tied
 * care team read it; a supporter reads it only after the person opted in for that reason. It never raises a clinician alert by itself.
 */
export interface DoseReasonDef {
  code: string;
  /** The dose status the tap records. */
  status: "skipped" | "not_available";
  private: boolean;
  /** Offer a gentle in-app prompt to open the pharmacy page. */
  opensPharmacy: boolean;
}

export const DOSE_REASONS: readonly DoseReasonDef[] = [
  { code: "side_effect", status: "skipped", private: false, opensPharmacy: false },
  { code: "felt_well", status: "skipped", private: false, opensPharmacy: false },
  { code: "ran_out", status: "not_available", private: true, opensPharmacy: true },
  { code: "other", status: "skipped", private: false, opensPharmacy: false },
];

export function doseReason(code: string | null | undefined, list: readonly DoseReasonDef[] = DOSE_REASONS): DoseReasonDef | null {
  return list.find((r) => r.code === code) ?? null;
}

export function isPrivateDoseReason(code: string | null | undefined, list: readonly DoseReasonDef[] = DOSE_REASONS): boolean {
  return doseReason(code, list)?.private === true;
}

/** True when a supporter may see this reason: it is not private, or the person opted in for exactly this reason. An unknown code is never shown. */
export function supporterMaySeeReason(code: string, optedIn: ReadonlySet<string>, list: readonly DoseReasonDef[] = DOSE_REASONS): boolean {
  const def = doseReason(code, list);
  if (def === null) return false;
  return !def.private || optedIn.has(code);
}

/** After this tap, should the app offer to open the pharmacy page? An offer only: nothing is sent and no alert is raised. */
export function shouldOfferPharmacy(code: string | null | undefined, list: readonly DoseReasonDef[] = DOSE_REASONS): boolean {
  return doseReason(code, list)?.opensPharmacy === true;
}
