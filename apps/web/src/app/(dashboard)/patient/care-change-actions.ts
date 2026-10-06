"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseConfirmOutcome, type ConfirmOutcome, type MessageKey } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";

const ConfirmInput = z.object({ changeId: z.string().uuid() });
const DeclineInput = z.object({ changeId: z.string().uuid(), reason: z.string().trim().max(500).optional() });

export type ConfirmCareChangeResult = { ok: true; outcome: Exclude<ConfirmOutcome, "error"> } | { ok: false; key: MessageKey };
export type DeclineCareChangeResult = { ok: true; key: MessageKey } | { ok: false; key: MessageKey };

const FAILED: MessageKey = "careChange.outcome.error";

/**
 * "Yes, make this change". Runs as the patient's own session: the database function checks that the change is
 * theirs, still waiting, and still safe to apply, and applies it only then. The patient's own click is the only
 * thing that calls this; nothing here applies a change on its own.
 */
export async function confirmCareChange(input: unknown): Promise<ConfirmCareChangeResult> {
  const parsed = ConfirmInput.safeParse(input);
  if (!parsed.success) return { ok: false, key: FAILED };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_care_plan_change", { p_change: parsed.data.changeId });
  if (error) return { ok: false, key: FAILED };
  const outcome = parseConfirmOutcome(data);
  if (outcome === "error") return { ok: false, key: FAILED };
  revalidatePath("/patient/medications");
  return { ok: true, outcome };
}

/** "Not now, I want to talk first". Changes nothing on the record; the care team is told. */
export async function declineCareChange(input: unknown): Promise<DeclineCareChangeResult> {
  const parsed = DeclineInput.safeParse(input);
  if (!parsed.success) return { ok: false, key: FAILED };
  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_care_plan_change", {
    p_change: parsed.data.changeId,
    ...(parsed.data.reason ? { p_reason: parsed.data.reason } : {}),
  });
  if (error) return { ok: false, key: FAILED };
  revalidatePath("/patient/medications");
  return { ok: true, key: "careChange.outcome.declined" };
}
