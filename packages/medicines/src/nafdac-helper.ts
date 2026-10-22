/**
 * NAFDAC check helper (item 14). Behind the go-live guard `nafdac_verify_helper_enabled` (OFF).
 *
 * Founder decision 2026-10-22: a link to NAFDAC's public registered-product check and nothing else. No text message, no short code and no
 * scratch code is handled here. A registration match is not proof that a pack is genuine.
 */
export interface NafdacHelperConfig {
  registrationCheck: { name: string; url: string; readOn: string };
}

export const NAFDAC_HELPER_CONFIG: NafdacHelperConfig = {
  registrationCheck: { name: "NAFDAC Greenbook", url: "https://greenbook.nafdac.gov.ng", readOn: "2026-10-22" },
};

/** The helper shows only while its guard is open. A guard that could not be read keeps it hidden. */
export function nafdacHelperVisible(guardState: "open" | "closed" | "unknown"): boolean {
  return guardState === "open";
}
