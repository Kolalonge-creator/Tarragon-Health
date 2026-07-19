"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  CONDITION_KEYS,
  type ConditionKey,
  type MeasurementInput,
  type PatientContext,
} from "@tarragon/lifestyle-engine";
import { enrollPatient } from "@/lib/lifestyle/service";
import { ingestMeasurement } from "@/lib/lifestyle/ingest";

export type LifestyleActionState = {
  error?: string;
  success?: boolean;
  message?: string;
} | undefined;

async function currentPatient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, error: "Not signed in" as const };
  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return { supabase, error: "No organisation on file" as const };
  }
  return { supabase, userId: user.id, orgId: profile.organisation_id };
}

const enrollSchema = z.object({
  conditionKey: z.enum(CONDITION_KEYS),
  consent: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
});

export async function enrollAction(
  _prev: LifestyleActionState,
  formData: FormData,
): Promise<LifestyleActionState> {
  const parsed = enrollSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Unknown programme" };
  if (!parsed.data.consent) {
    return { error: "Please agree to the consent statement to start." };
  }

  const ctx = await currentPatient();
  if (ctx.error) return { error: ctx.error };

  const result = await enrollPatient(ctx.userId!, ctx.orgId!, parsed.data.conditionKey);
  if (!result.ok) return { error: `Could not enrol (${result.reason ?? "error"})` };

  revalidatePath("/patient/lifestyle");
  return { success: true, message: "You're enrolled. Small steps from here." };
}

const logSchema = z.object({
  enrollmentId: z.string().uuid(),
  conditionKey: z.enum(CONDITION_KEYS),
  type: z.enum(["weight", "activity_minutes", "mood"]),
  value: z.coerce.number().finite().optional(),
  // A self-report that routes to safety (ED/self-harm auto-pause on obesity).
  strugglingWithFood: z
    .preprocess((v) => v === "on" || v === "true" || v === true, z.boolean())
    .optional(),
});

const UNIT: Record<ConditionKey | "weight" | "activity_minutes" | "mood", string> = {
  htn: "x",
  diabetes: "x",
  obesity: "x",
  weight: "kg",
  activity_minutes: "min",
  mood: "score",
};

export async function logReadingAction(
  _prev: LifestyleActionState,
  formData: FormData,
): Promise<LifestyleActionState> {
  const parsed = logSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { enrollmentId, conditionKey, type, value, strugglingWithFood } = parsed.data;

  const ctx = await currentPatient();
  if (ctx.error) return { error: ctx.error };

  // Build the measurement. A mood check-in carries the ED-risk self-report.
  const measurement: MeasurementInput =
    type === "mood"
      ? {
          type: "mood",
          valueJson: {
            scale: value ?? 3,
            eatingDisorderRisk: strugglingWithFood === true,
          },
          unit: UNIT.mood,
          takenAt: new Date().toISOString(),
          source: "web",
        }
      : {
          type,
          valueNum: value ?? 0,
          unit: UNIT[type],
          takenAt: new Date().toISOString(),
          source: "web",
        };

  // Minimal patient context for MVP; the safety-critical ED/self-harm signal
  // travels in the measurement payload, not here.
  const patientContext: PatientContext = {
    isPregnant: false,
    hasEatingDisorderHistory: false,
    highRisk: false,
  };

  const result = await ingestMeasurement({
    db: ctx.supabase,
    organisationId: ctx.orgId!,
    patientId: ctx.userId!,
    enrollmentId,
    conditionKey,
    patientContext,
    measurement,
  });

  if (!result.ok) return { error: `Could not save (${result.reason ?? "error"})` };

  revalidatePath("/patient/lifestyle");

  // Safety-first reply: a flagged reading never says "you're fine".
  if (result.evaluation?.hasFlag) {
    return {
      success: true,
      message:
        "Thanks for logging this. Your care team has been notified and a doctor will be in touch.",
    };
  }
  return { success: true, message: "Logged. Nice work keeping it up." };
}
