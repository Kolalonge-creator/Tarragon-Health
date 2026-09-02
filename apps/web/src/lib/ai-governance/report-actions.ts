"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { reportAiSafetyIncident } from "./audit";
import { AI_INCIDENT_CATEGORIES } from "./types";

/**
 * "The AI gave me incorrect information" (Module 40.12), from whoever is
 * looking at the answer — a patient or a clinician.
 *
 * Deliberately open to any signed-in account, and deliberately not
 * rate-limited or gated behind a role. A patient noticing that the coach told
 * them something wrong is the single highest-value safety signal this whole
 * module produces, and every gate in front of it loses reports. Severity is
 * not taken from the reporter: the database defaults it to moderate and a
 * clinician sets the real one at triage.
 */

const reportSchema = z.object({
  systemCode: z.string().trim().min(1),
  category: z.enum(AI_INCIDENT_CATEGORIES),
  description: z
    .string()
    .trim()
    .min(5, "Tell us a little about what was wrong — even one sentence helps.")
    .max(4000),
  interactionId: z.string().uuid().optional(),
});

export type ReportAiAnswerState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "sent" };

export async function reportAiAnswerAction(
  _prev: ReportAiAnswerState,
  formData: FormData
): Promise<ReportAiAnswerState> {
  const parsed = reportSchema.safeParse({
    systemCode: formData.get("systemCode"),
    category: formData.get("category"),
    description: formData.get("description"),
    interactionId: formData.get("interactionId") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Please check what you have written and try again.",
    };
  }

  const supabase = await createClient();
  const result = await reportAiSafetyIncident(supabase, {
    systemCode: parsed.data.systemCode,
    category: parsed.data.category,
    description: parsed.data.description,
    interactionId: parsed.data.interactionId ?? null,
  });

  return result.ok ? { status: "sent" } : { status: "error", message: result.message };
}
