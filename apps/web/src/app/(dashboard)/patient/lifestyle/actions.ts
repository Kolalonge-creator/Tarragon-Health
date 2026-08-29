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
import { ED_DISORDERED_BEHAVIOURS, obesityEdScreenSchema } from "@/lib/validation/obesity";

export type LifestyleActionState = {
  error?: string;
  success?: boolean;
  message?: string;
  /** Set when an obesity enrolment attempt was blocked pending the mandatory
   * ED/mental-health screen (§6.5) — the UI swaps in the screen form. */
  needsEdScreen?: boolean;
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
  if (!result.ok) {
    if (result.reason === "ed_screen_required") {
      return { needsEdScreen: true };
    }
    return { error: `Could not enrol (${result.reason ?? "error"})` };
  }

  revalidatePath("/patient/lifestyle");
  return { success: true, message: "You're enrolled. Small steps from here." };
}

const edScreenGateSchema = obesityEdScreenSchema.extend({
  consent: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
});

/**
 * The mandatory ED/mental-health screen (§6.5, §16, §18), self-reported by the
 * patient, immediately followed by the enrolment it was blocking. Scoring,
 * alert-raising, and any weight-loss auto-pause on an EXISTING enrolment are
 * DB-trigger owned (`private.handle_obesity_ed_screen`) — this only inserts
 * the answers and then calls the same `enrollPatient` every other condition
 * uses, which now finds a screen on file and enrols active or paused
 * accordingly. Never returns a clinical verdict either way — a positive
 * screen is framed as support, not a failure.
 */
export async function submitObesityEdScreenAndEnrollAction(
  _prev: LifestyleActionState,
  formData: FormData,
): Promise<LifestyleActionState> {
  const parsed = edScreenGateSchema.safeParse({
    consent: formData.get("consent"),
    scoff_sick: formData.get("scoff_sick") === "on",
    scoff_control: formData.get("scoff_control") === "on",
    scoff_one_stone: formData.get("scoff_one_stone") === "on",
    scoff_fat: formData.get("scoff_fat") === "on",
    scoff_food_dominates: formData.get("scoff_food_dominates") === "on",
    self_harm_risk: formData.get("self_harm_risk") === "on",
    low_mood: formData.get("low_mood") === "on",
    disordered_behaviours: formData.getAll("disordered_behaviours").filter((c) =>
      (ED_DISORDERED_BEHAVIOURS as readonly string[]).includes(c as string),
    ),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", needsEdScreen: true };
  }
  if (!parsed.data.consent) {
    return {
      error: "Please agree to the consent statement to start.",
      needsEdScreen: true,
    };
  }
  const input = parsed.data;

  const ctx = await currentPatient();
  if (ctx.error) return { error: ctx.error };

  const { data: saved, error: screenErr } = await ctx.supabase
    .from("obesity_ed_screens")
    .insert({
      organisation_id: ctx.orgId!,
      patient_id: ctx.userId!,
      scoff_sick: input.scoff_sick ?? false,
      scoff_control: input.scoff_control ?? false,
      scoff_one_stone: input.scoff_one_stone ?? false,
      scoff_fat: input.scoff_fat ?? false,
      scoff_food_dominates: input.scoff_food_dominates ?? false,
      self_harm_risk: input.self_harm_risk ?? false,
      low_mood: input.low_mood ?? false,
      disordered_behaviours: input.disordered_behaviours,
      notes: input.notes ?? null,
    })
    .select("positive")
    .single();
  if (screenErr || !saved) {
    return {
      error: "Could not save your answers, please try again.",
      needsEdScreen: true,
    };
  }

  const result = await enrollPatient(ctx.userId!, ctx.orgId!, "obesity");
  if (!result.ok) return { error: `Could not enrol (${result.reason ?? "error"})` };

  revalidatePath("/patient/lifestyle");
  revalidatePath("/patient/weight-management");

  if (saved.positive) {
    return {
      success: true,
      message:
        "Thanks for sharing that. Your care team will reach out to talk it through before we start on weight-loss goals; you're still enrolled and supported in the meantime.",
    };
  }
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
  revalidatePath("/patient/weight-management");

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

const GOAL_MODULES = ["diet", "activity", "behaviour", "sleep", "stress", "smoking"] as const;

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
    // Cast: 20260829222454_lpe_module_smoking.sql adds 'smoking' to the DB
    // enum, but database.types.ts hasn't been regenerated against it yet —
    // the generated public.lpe_module type here is still the 5 pre-existing
    // values. `module` (validated above by GOAL_MODULES, which does include
    // "smoking") is the real, correct value; only this compile-time type is
    // stale. Safe to delete once types are regenerated.
    p_module: module as "diet" | "activity" | "behaviour" | "sleep" | "stress",
    p_title: title,
    p_target_value: targetValue ?? undefined,
    p_target_unit: targetUnit ?? undefined,
    p_target_date: targetDate ?? undefined,
  });
  if (error) return { error: error.message || "Could not save your goal" };

  revalidatePath("/patient/lifestyle");
  revalidatePath("/patient/weight-management");
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

  const { data: goal, error } = await ctx.supabase.rpc("resolve_personalised_lifestyle_goal", {
    p_goal_id: parsed.data.goalId,
    p_status: parsed.data.status,
  });
  if (error) return { error: error.message || "Could not update this goal" };

  // Closing the loop spec §76.8 asks for: a completed stop-smoking goal
  // updates the same smoking_status question lib/cv-risk/assess.ts and the
  // health score's smoking component read (risk_assessment_responses,
  // question_key='smoking_status'), same shape as the questionnaire's own
  // insert in patient/actions.ts. Full response history is kept there by
  // design (a retake keeps prior answers), so this is a fresh row, not an
  // update — the latest one (order by created_at desc) is what's read.
  // Cast: same generated-types lag as createGoalAction's p_module above —
  // goal.module's generated type doesn't include "smoking" yet either.
  if (parsed.data.status === "achieved" && (goal?.module as string | undefined) === "smoking") {
    await ctx.supabase.from("risk_assessment_responses").insert({
      organisation_id: ctx.orgId!,
      profile_id: ctx.userId!,
      category: "lifestyle",
      question_key: "smoking_status",
      response: "former",
    });
  }

  revalidatePath("/patient/lifestyle");
  revalidatePath("/patient/weight-management");
  return {
    success: true,
    message:
      parsed.data.status === "achieved" ? "Nice work, marked as achieved." : "Goal removed.",
  };
}
