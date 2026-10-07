"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { parseOverview, type PrescriberOverview } from "./model";

/** The prescriber's side of S28 (OQ-288): the pharmacy's fixed questions with their answers, and where each prescription has got to. */
export type OverviewResult = { ok: true; overview: PrescriberOverview } | { ok: false; error: string };

function words(message: string | undefined): string {
  const m = message ?? "";
  if (m.includes("This is for clinicians")) return "This page is for clinicians.";
  if (m.includes("invalid_answer")) return "Please choose one of the answers.";
  if (m.includes("question_not_found")) return "That question could not be found.";
  return "That could not be done. Please try again.";
}

/** One audited read (INV-10) however many rows come back. An unreadable answer is a failed read, never an empty list. */
export async function loadPrescriberOverview(): Promise<OverviewResult> {
  const { data, error } = await loose(await createClient()).rpc("prescriber_pharmacy_overview", {});
  if (error) return { ok: false, error: words(error.message) };
  const overview = parseOverview(data);
  return overview ? { ok: true, overview } : { ok: false, error: "That could not be read. Please try again." };
}

const AnswerInput = z.object({ flagId: z.string().uuid(), answer: z.enum(["keep_as_written", "new_prescription_coming", "patient_to_contact_us"]) });
export type AnswerResult = { ok: true } | { ok: false; error: string };

export async function answerPharmacyQuestion(input: unknown): Promise<AnswerResult> {
  const parsed = AnswerInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: words("invalid_answer") };
  const { data, error } = await loose(await createClient()).rpc("answer_pharmacy_question", { p_flag: parsed.data.flagId, p_answer: parsed.data.answer });
  if (error) return { ok: false, error: words(error.message) };
  const result = z.object({ ok: z.boolean(), reason: z.string().optional() }).safeParse(data);
  // An unreadable answer is never treated as "answered".
  if (!result.success) return { ok: false, error: "That could not be recorded. Please try again." };
  if (!result.data.ok) {
    const r = result.data.reason;
    return { ok: false, error: r === "already_answered" ? "That question has already been answered." : r === "not_waiting" ? "That prescription is no longer waiting at the pharmacy that asked." : "That could not be recorded. Please try again." };
  }
  revalidatePath("/clinician/pharmacy");
  return { ok: true };
}
