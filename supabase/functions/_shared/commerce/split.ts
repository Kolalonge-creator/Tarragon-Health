/**
 * "You pay X. {Sponsor} pays Y." (S71, A4). Worked out in one place for the web order history and the phone, from the two integer-kobo numbers the
 * database already gives (what the person pays, what a sponsor covers). Returns null when there is nothing to say: nobody part-covered it (the person
 * pays everything), or the sponsor covered all of it (that case has its own "Covered by ..." wording and no payment step). The sponsor's name is passed
 * through exactly as the database gave it: null means the person may not see who it is, and the caller then uses the generic words.
 */
export interface SponsorSplit {
  readonly youKobo: number;
  readonly sponsorKobo: number;
  readonly sponsorName: string | null;
}

export function sponsorSplit(args: { readonly youKobo: number; readonly sponsorShareKobo: number; readonly sponsorName: string | null }): SponsorSplit | null {
  const { youKobo, sponsorShareKobo, sponsorName } = args;
  if (!Number.isSafeInteger(youKobo) || !Number.isSafeInteger(sponsorShareKobo)) return null;
  if (youKobo <= 0 || sponsorShareKobo <= 0) return null;
  return { youKobo, sponsorKobo: sponsorShareKobo, sponsorName };
}
