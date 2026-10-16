"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { verdictFormSchema, type Notice } from "./model";

const back = (n: Notice): never => redirect(`/clinician/ai-review?n=${n}`);

/** Saves a clinician's verdict on one sampled AI answer. A minor issue or harmful verdict needs a note; the database enforces it too. */
export async function reviewAiSampleAction(formData: FormData): Promise<void> {
  const parsed = verdictFormSchema.safeParse({ id: formData.get("id"), verdict: formData.get("verdict"), note: String(formData.get("note") ?? "") });
  if (!parsed.success) return back("failed");
  const { error } = await loose(await createClient()).rpc("review_ai_sample", {
    p_id: parsed.data.id,
    p_verdict: parsed.data.verdict,
    p_notes: parsed.data.note === "" ? null : parsed.data.note,
  });
  if (error) return back("failed");
  return back(parsed.data.verdict === "harmful" ? "harmful" : "saved");
}
