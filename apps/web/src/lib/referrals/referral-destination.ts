import { specialistTypeNoun } from "@tarragon/shared";

/**
 * S64 (15.6): what the "To:" block of a referral letter says. A named facility (a directory entry, or the typed fallback) is stated as
 * the destination; with none named the letter keeps its original wording, so existing referrals print exactly as before.
 */
export function referralDestination(specialistType: string, facilityName: string | null): { title: string; note: string } {
  const noun = specialistTypeNoun(specialistType);
  const name = facilityName?.trim();
  if (name) {
    return {
      title: `To: ${noun} at ${name}`,
      note: "Please see this patient at the facility named above. The patient settles any fee with the facility directly.",
    };
  }
  return {
    title: `To: any ${noun} the patient chooses`,
    note:
      "This patient has not been booked with a named specialist. They are free to attend whichever clinic suits them and will settle that clinic's fee directly.",
  };
}
