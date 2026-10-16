import { getProposedConfig } from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";

/**
 * What a cardiovascular risk band leads to (S47). The numbers come from the PROPOSED, unsigned config `risk.band_actions` (mirrored in the database as
 * risk_instrument_versions v2); the words are placeholders. The app never prescribes (INV-02): every line says "review" or "check", never "start a medicine",
 * and a doctor decides about medicines. The thresholds are not verified against WHO PEN / HEARTS. The WHO instrument itself stays OFF (coefficients missing).
 */
interface BandAction {
  copyKey: string;
  reassessMonths?: number;
  bpCheckEveryMonths?: number;
  careTeamReviewWithinWeeks?: number;
  doctorReviewWithinWeeks?: number;
  recheckEveryMonths?: number;
}

export function bandActions(): Record<string, BandAction> {
  return (getProposedConfig("risk.band_actions").value as unknown as { bands: Record<string, BandAction> }).bands;
}

/** The sentence for one band code (lt5, 5to10, 10to20, 20to30, ge30), or null for a code the config does not know. */
export function bandActionText(bandCode: string): string | null {
  const a = bandActions()[bandCode];
  if (!a) return null;
  const params = {
    weeks: a.careTeamReviewWithinWeeks ?? a.doctorReviewWithinWeeks ?? 0,
    months: a.recheckEveryMonths ?? a.bpCheckEveryMonths ?? a.reassessMonths ?? 0,
  };
  return t(a.copyKey as MessageKey, "en", params);
}
