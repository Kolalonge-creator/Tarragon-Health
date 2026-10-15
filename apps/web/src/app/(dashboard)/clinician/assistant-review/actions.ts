"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";

/**
 * S52 (spec 7.13): the monthly review of assistant conversations. Chief Medical Officer only (the database checks it again in every
 * function). The conversation text is read ONLY through assistant_review_read, which demands a reason and writes an audit row (INV-10);
 * the conversation read policy is not widened. This lives in apps/web under /clinician because the CMO's account role is `clinician`, and
 * apps/console is not widened to that role without extracting the area first.
 */
export type ReviewQueueRow = {
  id: string;
  month: string;
  selection: string;
  state: string;
  verdict: string | null;
  patientRef: string;
  turns: number;
  reported: boolean;
};

export type ReviewMessage = { role: string; content: string; tier?: string; created_at?: string; sources?: unknown };
export type ReviewConversation = {
  id: string;
  state: string;
  verdict: string | null;
  note: string | null;
  messages: ReviewMessage[];
};

async function guard(): Promise<boolean> {
  return canAssignCases(await getCurrentClinicalStaff());
}

export async function loadReviewQueueAction(): Promise<{ ok: true; rows: ReviewQueueRow[] } | { ok: false; error: string }> {
  if (!(await guard())) return { ok: false, error: "Only the Chief Medical Officer can open the monthly review." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assistant_review_queue");
  if (error) return { ok: false, error: "The review list could not be loaded just now. Please try again." };
  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      id: r.id,
      month: r.month,
      selection: r.selection,
      state: r.state,
      verdict: r.verdict,
      patientRef: r.patient_ref,
      turns: r.turns,
      reported: r.reported,
    })),
  };
}

const readSchema = z.object({ id: z.string().uuid(), reason: z.string().trim().min(10, "Say why you are reading this, in a sentence").max(500) });

export async function readSampleAction(input: { id: string; reason: string }): Promise<{ ok: true; conversation: ReviewConversation } | { ok: false; error: string }> {
  if (!(await guard())) return { ok: false, error: "Only the Chief Medical Officer can read a sampled conversation." };
  const parsed = readSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the reason" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assistant_review_read", { p_sample: parsed.data.id, p_reason: parsed.data.reason });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "Could not open that conversation. Please try again." };
  const row = data as Record<string, unknown>;
  return {
    ok: true,
    conversation: {
      id: String(row.id),
      state: String(row.state),
      verdict: typeof row.verdict === "string" ? row.verdict : null,
      note: typeof row.note === "string" ? row.note : null,
      messages: Array.isArray(row.messages) ? (row.messages as ReviewMessage[]) : [],
    },
  };
}

const VERDICTS = ["appropriate", "needs_improvement", "unsafe"] as const;
const CATEGORIES = ["none", "incorrect_information", "missed_escalation", "dose_or_medicine_advice", "sensitive_result", "tone", "other"] as const;
const recordSchema = z.object({
  id: z.string().uuid(),
  verdict: z.enum(VERDICTS),
  category: z.enum(CATEGORIES),
  note: z.string().trim().max(2000).optional(),
});

export async function recordReviewAction(input: { id: string; verdict: string; category: string; note?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await guard())) return { ok: false, error: "Only the Chief Medical Officer can record a review." };
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the review" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assistant_review_record", {
    p_sample: parsed.data.id,
    p_verdict: parsed.data.verdict,
    p_category: parsed.data.category,
    p_note: parsed.data.note,
  });
  if (error) return { ok: false, error: error.message.replace(/^.*?:\s*/, "").slice(0, 200) || "Could not record the review." };
  revalidatePath("/clinician/assistant-review");
  return { ok: true };
}
