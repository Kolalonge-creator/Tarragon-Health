"use server";

import { revalidatePath } from "next/cache";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import { describeFollowupError, formatLagos, pickResultSchema, uuidSchema } from "@/lib/followups/followups";

export type PickState = { error?: string; message?: string } | undefined;

const PAGE = "/patient/appointments";

/**
 * The Member chooses one of the times their care team offered. The database does the booking (it runs the live hold and confirm, so
 * the 10 minute hold, the Lagos grid, the age gate and the no-overlap rule all apply) and answers with a plain status. A taken or
 * expired time is a normal outcome, not an error: the page is refreshed so the Member sees what is left.
 */
export async function pickSlot(_prev: PickState, formData: FormData): Promise<PickState> {
  const slot = uuidSchema.safeParse(String(formData.get("slot_id") ?? ""));
  if (!slot.success) return { error: t("followups.patient.error", "en") };
  const askLonger = formData.get("ask_longer") === "on";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pick_followup_slot" as never, { p_slot: slot.data, p_ask_longer: askLonger } as never);
  if (error) return { error: describeFollowupError(error, t("followups.patient.error", "en")) };
  const parsed = pickResultSchema.safeParse(data);
  if (!parsed.success) return { error: t("followups.patient.error", "en") };
  revalidatePath(PAGE);
  switch (parsed.data.status) {
    case "booked":
      return { message: t("followups.patient.picked", "en", { when: parsed.data.starts_at ? formatLagos(parsed.data.starts_at) : "" }) };
    case "unavailable":
      return { error: t("followups.patient.unavailable", "en") };
    case "expired":
    case "withdrawn":
      return { error: t("followups.patient.expired", "en") };
    default:
      return { error: t("followups.patient.error", "en") };
  }
}

/** After booking, the Member can ask for more time. The doctor sees the flag before the call and can extend it. */
export async function askForLongerCall(_prev: PickState, formData: FormData): Promise<PickState> {
  const encounter = uuidSchema.safeParse(String(formData.get("encounter_id") ?? ""));
  if (!encounter.success) return { error: t("followups.patient.error", "en") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_longer_call" as never, { p_encounter: encounter.data } as never);
  if (error) return { error: describeFollowupError(error, t("followups.patient.error", "en")) };
  revalidatePath(PAGE);
  return { message: t("followups.patient.longer_asked", "en") };
}
