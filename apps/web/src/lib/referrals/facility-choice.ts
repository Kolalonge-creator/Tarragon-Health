/**
 * S64 (15.6): a referral names a directory facility OR a typed place, never both (the database refuses both, specialist_referrals_one_facility_form).
 * A directory choice always wins and clears the typed text, so the form can never send both.
 */
export interface FacilityChoice {
  facilityId: string | null;
  freeText: string | null;
}

export function resolveFacilityChoice(facilityId: string, freeText: string): FacilityChoice {
  if (facilityId.trim() !== "") return { facilityId: facilityId.trim(), freeText: null };
  const text = freeText.trim();
  return { facilityId: null, freeText: text === "" ? null : text.slice(0, 200) };
}
