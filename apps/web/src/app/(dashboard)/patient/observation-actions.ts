"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkObservation, mgDlToMmolL, observationRangeMessageKey, type Json, type ObservationLimitKey } from "@tarragon/shared";
import { en } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import { resolveSubjectId } from "@/lib/acting/acting-for";
import { inhalerUseSchema, moodSchema, sleepSchema, waterSchema } from "@/lib/validation/vitals";
import {
  lifestyleRow,
  NOT_SWITCHED_ON_MESSAGE,
  readExtendedObservationsEnabled,
  type LifestyleReading,
} from "@/lib/vitals/extended-observations";

/**
 * S47a (BUILD-SPEC-v5 4.2, 4.3, 4.7, 6.6): web entry for water, sleep, mood and inhaler use, and the patient's own correction of a logged number.
 *
 * - A refused number says plainly what to check (the sentence is in packages/i18n); a number that is only unusual asks for a second tap (`confirm`)
 *   and is never refused.
 * - Nothing here is a red-flag path: these types have no rule set, so nothing pages a clinician and nothing is sent to anyone (INV-07).
 * - The module `extended_observations` is checked first; the database refuses the rows too, so this is the friendly version of the same switch.
 * - A correction goes through public.correct_clinical_value (S05b): the original is kept, the replacement points at it, the chart shows the new one.
 */
export type ObservationActionState =
  | { error?: string; success?: boolean; /** An unusual number: show this and ask for a second tap. */ confirm?: string }
  | undefined;

const lifestyleSchema = z.discriminatedUnion("vital_type", [waterSchema, sleepSchema, moodSchema]);

const CONFIRM_MESSAGE: Partial<Record<ObservationLimitKey, { unusually_low?: string; unusually_high?: string }>> = {
  water_ml: { unusually_high: en["observation.confirm.water_ml_high"] },
  sleep_hours: { unusually_low: en["observation.confirm.sleep_hours_low"], unusually_high: en["observation.confirm.sleep_hours_high"] },
  inhaler_puffs: { unusually_high: en["observation.confirm.inhaler_puffs_high"] },
};

function confirmGiven(formData: FormData): boolean {
  return formData.get("confirm_unusual") === "yes";
}

async function whoAndWhere(): Promise<
  | { error: string }
  | { supabase: Awaited<ReturnType<typeof createClient>>; userId: string; subjectId: string; organisationId: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const subjectId = await resolveSubjectId(user.id);
  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", subjectId).single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };
  return { supabase, userId: user.id, subjectId, organisationId: profile.organisation_id };
}

export async function logObservation(_prev: ObservationActionState, formData: FormData): Promise<ObservationActionState> {
  const parsed = lifestyleSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the number and try again." };
  const reading = parsed.data as LifestyleReading;
  const limitKey = reading.vital_type;
  const value = reading[reading.vital_type] as number;

  const check = checkObservation(limitKey, value);
  if (!check.ok) return { error: en[observationRangeMessageKey(limitKey)] };
  if (check.warn && !confirmGiven(formData)) {
    const msg = CONFIRM_MESSAGE[limitKey]?.[check.warn];
    if (msg) return { confirm: msg };
  }

  try {
    const ctx = await whoAndWhere();
    if ("error" in ctx) return { error: ctx.error };
    if (!(await readExtendedObservationsEnabled(ctx.supabase))) return { error: NOT_SWITCHED_ON_MESSAGE };
    // The form carries a key made once per form, so a double click or a resubmit of the same entry is one row, not two.
    const clientKey = z.string().uuid().safeParse(formData.get("client_reading_id"));
    const row = lifestyleRow(reading, { patientId: ctx.subjectId, organisationId: ctx.organisationId, clientReadingId: clientKey.success ? clientKey.data : undefined });
    const { error } = await ctx.supabase.from("vitals_readings").insert(row);
    if (error) {
      if (clientKey.success && error.code === "23505") return { success: true };
      // 23514: the database's own plausibility CHECK answered; say the same plain sentence
      if (error.code === "23514") return { error: en[observationRangeMessageKey(limitKey)] };
      if (error.code === "55000") return { error: NOT_SWITCHED_ON_MESSAGE };
      return { error: "Couldn't save that. Check your connection and try again." };
    }
    revalidatePath("/patient/vitals");
    revalidatePath("/patient/nutrition");
    return { success: true };
  } catch (err) {
    Sentry.captureException(err, { extra: { action: "logObservation", vitalType: limitKey } });
    return { error: "Couldn't save that. Check your connection and try again." };
  }
}

export async function logInhalerUse(_prev: ObservationActionState, formData: FormData): Promise<ObservationActionState> {
  const parsed = inhalerUseSchema.safeParse({ vital_type: "inhaler_use", ...Object.fromEntries(formData.entries()) });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the number and try again." };
  const check = checkObservation("inhaler_puffs", parsed.data.puffs);
  if (!check.ok) return { error: en["observation.range.inhaler_puffs"] };
  if (check.warn && !confirmGiven(formData)) {
    const msg = CONFIRM_MESSAGE.inhaler_puffs?.[check.warn];
    if (msg) return { confirm: msg };
  }
  try {
    const ctx = await whoAndWhere();
    if ("error" in ctx) return { error: ctx.error };
    if (!(await readExtendedObservationsEnabled(ctx.supabase))) return { error: NOT_SWITCHED_ON_MESSAGE };
    const clientKey = z.string().uuid().safeParse(formData.get("client_reading_id"));
    const { error } = await ctx.supabase.rpc("log_inhaler_use", {
      p_puffs: parsed.data.puffs,
      p_reason: parsed.data.reason,
      ...(clientKey.success ? { p_client_log_id: clientKey.data } : {}),
      ...(ctx.subjectId !== ctx.userId ? { p_beneficiary: ctx.subjectId } : {}),
    });
    if (error) return { error: error.code === "55000" ? NOT_SWITCHED_ON_MESSAGE : "Couldn't save that. Check your connection and try again." };
    revalidatePath("/patient/vitals");
    return { success: true };
  } catch (err) {
    Sentry.captureException(err, { extra: { action: "logInhalerUse" } });
    return { error: "Couldn't save that. Check your connection and try again." };
  }
}

// --- the patient corrects her own number --------------------------------------------------------------------------------------------------
type Correctable = { limit: ObservationLimitKey; column: string };
const CORRECTABLE: Record<string, Correctable> = {
  weight: { limit: "weight_kg", column: "weight_kg" },
  waist_circumference: { limit: "waist_cm", column: "waist_cm" },
  pulse: { limit: "pulse_bpm", column: "pulse_bpm" },
  temperature: { limit: "temperature_c", column: "temperature_c" },
  spo2: { limit: "spo2_pct", column: "spo2_pct" },
  water_ml: { limit: "water_ml", column: "value_numeric" },
  sleep_hours: { limit: "sleep_hours", column: "value_numeric" },
  mood: { limit: "mood", column: "value_numeric" },
};

const correctSchema = z.object({
  reading_id: z.string().uuid(),
  vital_type: z.string(),
  new_value: z.coerce.number({ message: "Enter the right number." }),
  glucose_unit: z.enum(["mmol_l", "mg_dl"]).optional(),
  reason: z.string().trim().min(5, "Say in a few words what was wrong (at least 5 characters).").max(300),
});

/**
 * Blood pressure is not editable here (the pair of numbers and its red-flag history stay as recorded; a wrong BP goes to the care team). Everything
 * else a person types is: the original is kept as history, the replacement carries `supersedes_id`, and the chart shows the new number with a "Changed" marker.
 */
export async function correctOwnReading(_prev: ObservationActionState, formData: FormData): Promise<ObservationActionState> {
  const parsed = correctSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const { reading_id, new_value, reason } = parsed.data;

  // The type comes from the stored row, never from the form: a stale or crafted post must not apply (say) a weight to a pulse or blood pressure row.
  let vital_type: string;
  try {
    const supabase = await createClient();
    const { data: stored, error: readError } = await supabase.from("vitals_readings").select("vital_type").eq("id", reading_id).maybeSingle();
    if (readError) return { error: "Couldn't change that. Check your connection and try again." };
    if (!stored) return { error: "That reading could not be found." };
    vital_type = stored.vital_type;
  } catch (err) {
    Sentry.captureException(err, { extra: { action: "correctOwnReading", stage: "read" } });
    return { error: "Couldn't change that. Check your connection and try again." };
  }
  if (parsed.data.vital_type !== vital_type) return { error: "That reading does not match the form. Reload the page and try again." };

  let replacement: Json;
  let limitKey: ObservationLimitKey;
  if (vital_type === "glucose") {
    const unit = parsed.data.glucose_unit ?? "mmol_l";
    limitKey = unit === "mg_dl" ? "glucose_mg_dl" : "glucose_mmol_l";
    replacement = { glucose_mmol_l: unit === "mg_dl" ? mgDlToMmolL(new_value) : new_value };
  } else {
    const c = CORRECTABLE[vital_type];
    if (!c) return { error: "That reading cannot be changed here. Ask your care team to correct it." };
    limitKey = c.limit;
    replacement = { [c.column]: new_value };
  }
  const check = checkObservation(limitKey, new_value);
  if (!check.ok) return { error: en[observationRangeMessageKey(limitKey)] };

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("correct_clinical_value", {
      p_table: "vitals_readings",
      p_id: reading_id,
      p_status: "corrected",
      p_reason: reason,
      p_replacement: replacement,
    });
    if (error) {
      if (error.code === "42501") return { error: "A care team member has already reviewed or recorded this one. Ask them to correct it." };
      if (error.code === "22023") return { error: "This entry was already changed." };
      if (error.code === "55000") return { error: NOT_SWITCHED_ON_MESSAGE };
      if (error.code === "23514") return { error: en[observationRangeMessageKey(limitKey)] };
      return { error: "Couldn't change that. Check your connection and try again." };
    }
    revalidatePath("/patient/vitals");
    return { success: true };
  } catch (err) {
    Sentry.captureException(err, { extra: { action: "correctOwnReading", vitalType: vital_type } });
    return { error: "Couldn't change that. Check your connection and try again." };
  }
}

const correctInhalerSchema = z.object({
  id: z.string().uuid(),
  puffs: z.coerce.number({ message: en["observation.range.inhaler_puffs"] }).int(en["observation.range.inhaler_puffs"]).min(1, en["observation.range.inhaler_puffs"]).max(20, en["observation.range.inhaler_puffs"]),
  reason: z.enum(["breathless_or_wheeze", "before_exercise", "routine_dose", "night_symptoms", "other"]),
  why: z.string().trim().min(5, "Say in a few words what was wrong (at least 5 characters).").max(300),
});

/**
 * The person changes one of her own inhaler entries. The original is kept; the replacement points at it and the list marks it Changed. Only she can do
 * this: the database refuses a supporter and anyone else.
 */
export async function correctInhalerUse(_prev: ObservationActionState, formData: FormData): Promise<ObservationActionState> {
  const parsed = correctInhalerSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("correct_inhaler_use", {
      p_id: parsed.data.id,
      p_puffs: parsed.data.puffs,
      p_reason: parsed.data.reason,
      p_why: parsed.data.why,
    });
    if (error) {
      if (error.code === "42501") return { error: "You can only change your own entries." };
      if (error.code === "22023") return { error: error.message.includes("already changed") ? "This entry was already changed." : en["observation.range.inhaler_puffs"] };
      if (error.code === "55000") return { error: NOT_SWITCHED_ON_MESSAGE };
      return { error: "Couldn't change that. Check your connection and try again." };
    }
    revalidatePath("/patient/vitals");
    return { success: true };
  } catch (err) {
    Sentry.captureException(err, { extra: { action: "correctInhalerUse" } });
    return { error: "Couldn't change that. Check your connection and try again." };
  }
}
