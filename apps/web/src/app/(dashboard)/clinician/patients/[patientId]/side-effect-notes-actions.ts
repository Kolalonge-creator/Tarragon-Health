"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { ROUTINE_CHART_READ_REASON } from "@/lib/clinical/audited-chart";

const schema = z.object({ patientId: z.string().uuid(), noteIds: z.array(z.string().uuid()).min(1).max(100) });

/** Marks exactly the notes the clinician was shown as reviewed. The database checks the tie and writes the audit row. */
export async function markSideEffectNotesReviewed(input: { patientId: string; noteIds: string[] }): Promise<{ ok: boolean }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_side_effect_notes_reviewed", {
    p_patient: parsed.data.patientId,
    p_note_ids: parsed.data.noteIds,
    p_reason: ROUTINE_CHART_READ_REASON,
  });
  if (error) return { ok: false };
  revalidatePath(`/clinician/patients/${parsed.data.patientId}`);
  return { ok: true };
}
