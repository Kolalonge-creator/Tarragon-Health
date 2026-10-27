"use server";

import { createClient } from "@/lib/supabase/server";
import { recordTimeEntry } from "@/lib/clinician/time-record";
import { timeEntryInputSchema, type TimeEntryInput } from "@/lib/clinician/time-capture";

export type RecordTimeResult = { ok: boolean };

/**
 * Record some of the signed-in clinician's own time (W-01). The database decides whether the work is theirs; a refusal returns ok:false and
 * is never shown as an error, because time capture must never get in the way of the work it measures.
 */
export async function recordClinicianTime(input: TimeEntryInput): Promise<RecordTimeResult> {
  const parsed = timeEntryInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  return recordTimeEntry(await createClient(), parsed.data);
}
