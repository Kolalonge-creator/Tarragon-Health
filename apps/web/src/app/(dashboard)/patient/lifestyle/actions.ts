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

const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const GOAL_MODULES = ["diet", "activity", "behaviour", "sleep", "stress"] as const;

const createGoalSchema = z.object({
  enrollmentId: z.string().uuid(),
  module: z.enum(GOAL_MODULES),
  title: z.string().trim().min(1, "Please describe your goal").max(200),
  targetValue: z.preprocess(emptyToUndefined, z.coerce.number().finite().positive().optional()),
  targetUnit: z.preprocess(emptyToUndefined, z.string().trim().max(40).optional()),
  targetDate: z.preprocess(emptyToUndefined, z.string().optional()),
});

export async function createGoalAction(
  _prev: LifestyleActionState,
  formData: FormData,
): Promise<LifestyleActionState> {
  const parsed = createGoalSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { enrollmentId, module, title, targetValue, targetUnit, targetDate } = parsed.data;

  const ctx = await currentPatient();
  if (ctx.error) return { error: ctx.error };

  const { error } = await ctx.supabase.rpc("create_personalised_lifestyle_goal", {
    p_enrollment_id: enrollmentId,
    p_module: module,
    p_title: title,
    p_target_value: targetValue ?? null,
    p_target_unit: targetUnit ?? null,
    p_target_date: targetDate ?? null,
  });
  if (error) return { error: error.message || "Could not save your goal" };

  revalidatePath("/patient/lifestyle");
  return { success: true, message: "Goal added." };
}

const resolveGoalSchema = z.object({
  goalId: z.string().uuid(),
  status: z.enum(["achieved", "abandoned"]),
});

export async function resolveGoalAction(
  _prev: LifestyleActionState,
  formData: FormData,
): Promise<LifestyleActionState> {
  const parsed = resolveGoalSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Invalid input" };

  const ctx = await currentPatient();
  if (ctx.error) return { error: ctx.error };

  const { error } = await ctx.supabase.rpc("resolve_personalised_lifestyle_goal", {
    p_goal_id: parsed.data.goalId,
    p_status: parsed.data.status,
  });
  if (error) return { error: error.message || "Could not update this goal" };

  revalidatePath("/patient/lifestyle");
  return {
    success: true,
    message:
      parsed.data.status === "achieved" ? "Nice work — marked as achieved." : "Goal removed.",
  };
}
