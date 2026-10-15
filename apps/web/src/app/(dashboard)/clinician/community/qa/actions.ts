"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { outcomeSchema } from "@/lib/community/model";
import { createClient } from "@/lib/supabase/server";
import { toResult } from "@/components/community/staff-rpc";
import type { StaffActionResult } from "@/components/community/staff-types";
import { QA_ANSWER_MAX as ANSWER_MAX, QA_ANSWER_MIN as ANSWER_MIN } from "@/components/community/qa-limits";

/**
 * A named doctor answers a question in a doctor question session. The database checks that this person is named on the session and
 * that it is open (auth.uid() inside the function); the answer goes through the same text filters as any post.
 */
const LENGTH_MESSAGE = `Please write an answer of ${ANSWER_MIN} to ${ANSWER_MAX} characters.`;

const answerSchema = z.object({
  postId: z.string().uuid(),
  body: z.string().trim().min(ANSWER_MIN).max(ANSWER_MAX),
});

export async function answerQuestionAction(input: unknown): Promise<StaffActionResult> {
  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: LENGTH_MESSAGE };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_qa_answer", { p_post_id: parsed.data.postId, p_body: parsed.data.body });
  // The shared refusal text for a wrong length is written for short prompts (5 to 300); an answer may run to 1500.
  const outcome = outcomeSchema.safeParse(data);
  if (!error && outcome.success && outcome.data.status === "refused" && outcome.data.reason === "bad_length") {
    return { ok: false, message: LENGTH_MESSAGE };
  }
  const result = toResult(data, error, { ok: "Your answer was saved. It shows your name." }, {
    "42501": "You are not named on this session, so you cannot answer here.",
  });
  if (result.ok) revalidatePath("/clinician/community/qa");
  return result;
}
