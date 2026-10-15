"use server";

import { revalidatePath } from "next/cache";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import {
  bulkResultSchema,
  describeFollowupError,
  followupLimits,
  parseOfferForm,
  singleOfferResultSchema,
  uuidSchema,
} from "@/lib/followups/followups";

export type FollowupActionState = { error?: string; message?: string; refused?: string[] } | undefined;

const PAGE = "/clinician/followups";

/**
 * The doctor offers several times to one or more of their Members. Everything is checked again in the database (tie, Membership,
 * the doctor's own hours and bookings, leave, the entitlement); this only turns the form into a clean call and the answer into words.
 */
export async function offerTimes(_prev: FollowupActionState, formData: FormData): Promise<FollowupActionState> {
  const limits = followupLimits();
  const parsed = parseOfferForm(
    {
      patients: formData.getAll("patients").map(String),
      times: formData.getAll("times").map(String),
      kind: String(formData.get("kind") ?? "monthly"),
      minutes: String(formData.get("minutes") ?? ""),
    },
    limits,
  );
  if (!parsed.ok) {
    const params = { min: limits.minSlots, max: limits.maxSlots, routineMin: limits.routineMin, routineMax: limits.routineMax };
    switch (parsed.error) {
      case "no_members":
        return { error: t("followups.err.no_members", "en") };
      case "too_many_members":
        return { error: t("followups.err.too_many_members", "en", { max: limits.bulkMax }) };
      case "times":
        return { error: t("followups.err.times", "en", params) };
      case "bad_time":
        return { error: t("followups.err.bad_time", "en") };
      case "minutes":
        return { error: t("followups.err.minutes", "en", { min: limits.routineMin, max: limits.routineMax }) };
    }
  }
  if (parsed.minutes !== null && parsed.patients.length > 1) return { error: t("followups.err.minutes_single", "en") };

  const supabase = await createClient();
  if (parsed.patients.length === 1) {
    const { data, error } = await supabase.rpc("offer_followup_slots" as never, {
      p_patient: parsed.patients[0],
      p_starts: parsed.starts,
      p_kind: parsed.kind,
      p_minutes: parsed.minutes,
    } as never);
    if (error) return { error: describeFollowupError(error, t("followups.err.generic", "en")) };
    if (!singleOfferResultSchema.safeParse(data).success) return { error: t("followups.err.generic", "en") };
    revalidatePath(PAGE);
    return { message: t("followups.offered_ok", "en") };
  }

  const { data, error } = await supabase.rpc("offer_followup_slots_bulk" as never, {
    p_patients: parsed.patients,
    p_starts: parsed.starts,
    p_kind: parsed.kind,
  } as never);
  if (error) return { error: describeFollowupError(error, t("followups.err.generic", "en")) };
  const result = bulkResultSchema.safeParse(data);
  if (!result.success) return { error: t("followups.err.generic", "en") };
  revalidatePath(PAGE);
  const refused = result.data.results.filter((r) => r.status === "refused");
  return {
    message: t("followups.bulk_result", "en", { ok: result.data.offered, refused: refused.length }),
    refused: [...new Set(refused.map((r) => r.reason ?? t("followups.err.generic", "en")))],
  };
}

/** Withdraw an open offer: its times stop being offered and the Member is told they changed. */
export async function withdrawOffer(_prev: FollowupActionState, formData: FormData): Promise<FollowupActionState> {
  const id = uuidSchema.safeParse(String(formData.get("offer_id") ?? ""));
  if (!id.success) return { error: t("followups.err.withdraw", "en") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_followup_offer" as never, { p_offer: id.data } as never);
  if (error) return { error: describeFollowupError(error, t("followups.err.withdraw", "en")) };
  revalidatePath(PAGE);
  return { message: t("followups.sent.withdrawn", "en") };
}
