import { z } from "zod";

/**
 * The ONE way safety code asks "is this patient pregnant?" (OQ-555 follow-up).
 *
 * Why this exists. Reading `patient_pregnancy` straight from the table with the caller's own session cannot tell "no row" from "row security hid the row":
 * both come back as null data and no error. Five safety readers then defaulted to "not pregnant" (`?? false`) for a clinician who was not tied to the
 * patient. This helper calls `public.pregnancy_safety_status`, which answers with a THREE-STATE result decided inside the database:
 *   pregnant | not_pregnant | unknown
 * 'unknown' means the caller was not allowed to look (not tied, break-glass, view-as, coordinator, caregiver) or the read failed. It is never turned into
 * "not pregnant". Where a medicine or a threshold depends on it, callers take the cautious branch (treat as possibly pregnant) and say so.
 *
 * It never throws: an error, a malformed reply and a missing session are all 'unknown'.
 */

export type PregnancyStatus = "pregnant" | "not_pregnant" | "unknown";

export interface PregnancySafety {
  status: PregnancyStatus;
  /** Whether a patient_pregnancy row exists. Some callers are stricter than the platform default and treat "no record" as unknown. */
  hasRecord: boolean;
  /** The latest recorded delivery date, or null. */
  lastDeliveryDate: string | null;
}

/** The message every prescribing or dosing surface shows when the status is unknown. */
export const PREGNANCY_UNKNOWN_MESSAGE = "Pregnancy status could not be read. Check before prescribing.";

/** The slice of the Supabase client this needs, so a test can pass a fake. */
export interface PregnancyRpcClient {
  rpc(fn: "pregnancy_safety_status", args: { p_patient: string }): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
}

const replySchema = z.object({
  pregnancy: z.enum(["pregnant", "not_pregnant", "unknown"]),
  has_record: z.boolean(),
  last_delivery_date: z.string().nullable(),
});

const UNKNOWN: PregnancySafety = { status: "unknown", hasRecord: false, lastDeliveryDate: null };

export async function readPregnancySafety(client: PregnancyRpcClient, patientId: string): Promise<PregnancySafety> {
  try {
    const { data, error } = await client.rpc("pregnancy_safety_status", { p_patient: patientId });
    if (error) return UNKNOWN;
    const parsed = replySchema.safeParse(data);
    if (!parsed.success) return UNKNOWN;
    return { status: parsed.data.pregnancy, hasRecord: parsed.data.has_record, lastDeliveryDate: parsed.data.last_delivery_date };
  } catch {
    return UNKNOWN;
  }
}

/** The cautious reading for a medicine or a threshold that changes in pregnancy: anything but a clear "not pregnant" counts as possibly pregnant. */
export function isPossiblyPregnant(status: PregnancyStatus): boolean {
  return status !== "not_pregnant";
}

/**
 * What a prescribing surface does with the answer: `pregnant` is the cautious flag handed to the drug-safety rules (true for pregnant AND unknown), and
 * `unknown` says the prescriber must be shown PREGNANCY_UNKNOWN_MESSAGE.
 */
export function pregnancyForPrescribing(status: PregnancyStatus): { pregnant: boolean; unknown: boolean } {
  return { pregnant: isPossiblyPregnant(status), unknown: status === "unknown" };
}
