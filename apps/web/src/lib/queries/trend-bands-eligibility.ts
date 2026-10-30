import { trendBandsEligible } from "@tarragon/shared";
import { readPregnancySafety, type PregnancyRpcClient } from "@/lib/clinical/pregnancy-status";

/** The profile row the caller already read (date of birth and the profile pregnancy flag). */
export interface TrendBandsProfile {
  data: { date_of_birth: string | null; is_pregnant: boolean | null } | null;
  error: unknown;
}

/**
 * S47a / OQ-555 follow-up: whether the standard target bands may be drawn on this person's glucose and weight charts. The pregnancy answer is the database's
 * three-state one (pregnant, not_pregnant, unknown): an UNKNOWN status (the viewer is not tied or acting for her, or the read failed) draws NO band, never a
 * band for someone who may be pregnant. A recent delivery and the profile flag also stop it, exactly as before.
 */
export async function readTrendBandsEligible(
  client: PregnancyRpcClient,
  patientId: string,
  moduleEnabled: boolean,
  prof: TrendBandsProfile,
): Promise<boolean> {
  const pregnancy = await readPregnancySafety(client, patientId);
  if (prof.error || !prof.data) return false;
  if (pregnancy.status === "unknown") return false;
  return trendBandsEligible({
    moduleEnabled,
    dateOfBirth: prof.data.date_of_birth,
    isPregnant: prof.data.is_pregnant === true || pregnancy.status === "pregnant",
    lastDeliveryDate: pregnancy.lastDeliveryDate,
  });
}
