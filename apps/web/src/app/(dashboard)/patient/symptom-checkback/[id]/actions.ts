"use server";

import { createClient } from "@/lib/supabase/server";
import { answerCheckback } from "@/lib/symptom-checkback/answer";
import { getActingFor } from "@/lib/acting/acting-for";
import { recordDescribeDanger, type DescribeDangerResult } from "@/lib/symptom-checkback/describe-danger";
import type { SubmitCheckbackResult } from "@/lib/symptom-checkback/model";

/**
 * S59c: the patient sends their follow-up answer. Everything that matters (own follow-up only, open only, the decision table, the alert
 * carrying the original summary) is decided in the database function; the red-flag floor is re-run in `answerCheckback` from the stored
 * answers. A result is a short reason code, never a database message.
 */
export async function submitCheckbackAction(input: unknown): Promise<SubmitCheckbackResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return answerCheckback(supabase, user?.id ?? null, input);
}

/**
 * S59c (OQ-S59c-05): danger wording was found in the describe box on the device. Only the session key and a coarse code arrive here, never
 * the words. Returns whether the fact was recorded; the screen says the care team was told only if it was.
 */
export async function recordDescribeDangerAction(input: unknown): Promise<DescribeDangerResult> {
  // acting for someone else: auth.uid() would be the carer, so the event and the page would land on the WRONG person. Record nothing; the guidance stays on screen.
  if (await getActingFor()) return { recorded: false, doctorAlerted: false, reason: "acting_for" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return recordDescribeDanger(supabase, user?.id ?? null, input);
}
