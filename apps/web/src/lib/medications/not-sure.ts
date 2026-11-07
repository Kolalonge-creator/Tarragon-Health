import { z } from "zod";

/**
 * P16 (CMO decision from chat, 2026-11-07). A "Not sure" answer becomes a routine medication_dispense_flags row
 * (flag_type 'patient_query'), the existing route into the /clinician/medication-issues worklist. The note always starts
 * with this prefix: the database keeps one such row per patient per Lagos day on it
 * (medication_dispense_flags_not_sure_one_per_day), so the prefix must match that index exactly.
 */
export const NOT_SURE_NOTE_PREFIX = 'Patient answered "Not sure"';

export const notSureInputSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("checkin"), checkinId: z.string().uuid() }),
  z.object({ source: z.literal("reconciliation") }),
]);
export type NotSureInput = z.infer<typeof notSureInputSchema>;

const CHECKIN_LABEL: Record<string, string> = {
  started: "whether they have started it",
  side_effects: "side effects",
  missed_doses: "missed doses",
  lab_review: "a follow-up review",
};

/** The worklist note, built on the server from records, never from client text. */
export function notSureNote(
  source: NotSureInput["source"],
  detail: { drugName?: string | null; checkinType?: string | null } = {}
): string {
  if (source === "reconciliation") {
    return `${NOT_SURE_NOTE_PREFIX} when asked to confirm their medication list. Routine: please go through the list with them.`;
  }
  const about = detail.checkinType ? CHECKIN_LABEL[detail.checkinType] ?? detail.checkinType.replace(/_/g, " ") : null;
  return `${NOT_SURE_NOTE_PREFIX} to a medication check-in${detail.drugName ? ` about ${detail.drugName}` : ""}${about ? ` (${about})` : ""}. Routine: please follow up.`;
}
