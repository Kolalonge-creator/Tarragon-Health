"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { briefFeedbackSchema, overrideReasonCodeSchema } from "@/lib/clinician/override-reasons";

const inputSchema = z.object({
  briefId: z.string().uuid(),
  feedback: briefFeedbackSchema,
  code: overrideReasonCodeSchema.nullable(),
});

/** W-02: one tap on an AI-drafted case brief. Best effort: a failure never affects the case. */
export async function recordCaseBriefFeedback(input: z.infer<typeof inputSchema>): Promise<{ ok: boolean }> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const supabase = loose(await createClient());
  const { error } = await supabase.rpc("record_case_brief_feedback", {
    p_brief: parsed.data.briefId,
    p_feedback: parsed.data.feedback,
    ...(parsed.data.code ? { p_code: parsed.data.code } : {}),
  });
  return { ok: !error };
}
