"use server";

import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { timeEntryInputSchema, type TimeEntryInput } from "@/lib/clinician/time-capture";

export type RecordTimeResult = { ok: boolean };

/**
 * Record some of the signed-in clinician's own time (W-01). The database decides whether the task or thread is theirs; a refusal returns
 * ok:false and is never shown as an error, because time capture must never get in the way of the work it measures.
 */
export async function recordClinicianTime(input: TimeEntryInput): Promise<RecordTimeResult> {
  const parsed = timeEntryInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const supabase = loose(await createClient());
  const { error } = await supabase.rpc("record_clinician_time", {
    p_source: parsed.data.source,
    p_source_ref: parsed.data.sourceRef,
    p_patient: parsed.data.patientId,
    p_seconds: parsed.data.seconds,
  });
  return { ok: !error };
}
