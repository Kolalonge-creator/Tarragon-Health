"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { PeopleActionState } from "./actions";
import { safePeopleError } from "./people-errors";

/**
 * HR Phase B training writes. The rules live in the database functions (admin only; a completion is verified only by a
 * different admin; records are voided, never edited or deleted; a void needs a reason). These actions validate the form and
 * pass a database refusal through as plain words.
 */
interface Rpc {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

const blankToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);
const optionalUuid = z.preprocess(blankToUndefined, z.string().uuid().optional());
const optionalText = (max: number) => z.preprocess((v) => (v === null ? undefined : v), z.string().trim().max(max).optional());
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give a date.");

async function call(fn: string, args: Record<string, unknown>, message: string, path = "/admin/people"): Promise<PeopleActionState> {
  const supabase = (await createClient()) as unknown as Rpc;
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: safePeopleError(error) };
  revalidatePath(path, "layout");
  return { message };
}

const courseSchema = z.object({
  id: optionalUuid,
  name: z.string().trim().min(2, "Give the course a name.").max(120),
  category: z.enum(["mandatory", "professional"]),
  provider: optionalText(120),
  description: optionalText(500),
  renewalMonths: z.preprocess(blankToUndefined, z.coerce.number().int().min(1, "Renewal is 1 to 120 months.").max(120, "Renewal is 1 to 120 months.").optional()),
  active: z.preprocess((v) => v !== "false", z.boolean()),
});

export async function saveCourse(_prev: PeopleActionState, form: FormData): Promise<PeopleActionState> {
  const parsed = courseSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const v = parsed.data;
  return call("save_training_course", {
    p_id: v.id ?? null,
    p_name: v.name,
    p_category: v.category,
    p_provider: v.provider || null,
    p_description: v.description || null,
    p_renewal_months: v.renewalMonths ?? null,
    p_active: v.active,
  }, v.id ? "Course updated." : "Course added.");
}

const requirementSchema = z
  .object({
    courseId: z.string().uuid("Choose a course."),
    appliesTo: z.enum(["everyone", "role", "department"]),
    role: z.preprocess(blankToUndefined, z.string().optional()),
    departmentId: optionalUuid,
    dueWithinDays: z.coerce.number().int().min(0).max(365),
  })
  .superRefine((v, ctx) => {
    if (v.appliesTo === "role" && !v.role) ctx.addIssue({ code: "custom", path: ["role"], message: "Choose a role." });
    if (v.appliesTo === "department" && !v.departmentId) ctx.addIssue({ code: "custom", path: ["departmentId"], message: "Choose a department." });
  });

export async function addRequirement(_prev: PeopleActionState, form: FormData): Promise<PeopleActionState> {
  const parsed = requirementSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const v = parsed.data;
  return call("add_training_requirement", {
    p_course: v.courseId,
    p_applies_to: v.appliesTo,
    p_role: v.appliesTo === "role" ? v.role : null,
    p_department: v.appliesTo === "department" ? v.departmentId : null,
    p_due_within_days: v.dueWithinDays,
  }, "Requirement added.");
}

const dueSchema = z.object({
  requirementId: z.string().uuid(),
  dueWithinDays: z.coerce.number().int().min(0, "Give 0 to 365 days.").max(365, "Give 0 to 365 days."),
});

/** Change how long people have, in place (removing and re-adding a rule would restart everyone's clock). */
export async function setRequirementDue(_prev: PeopleActionState, form: FormData): Promise<PeopleActionState> {
  const parsed = dueSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  return call("set_training_requirement_due", { p_requirement: parsed.data.requirementId, p_due_within_days: parsed.data.dueWithinDays }, "Saved.");
}

export async function removeRequirement(_prev: PeopleActionState, form: FormData): Promise<PeopleActionState> {
  const id = z.string().uuid().safeParse(form.get("requirementId"));
  if (!id.success) return { error: "That requirement was not found." };
  return call("remove_training_requirement", { p_requirement: id.data }, "Requirement removed.");
}

const completionSchema = z.object({
  profileId: z.string().uuid(),
  courseId: z.string().uuid("Choose a course."),
  completedOn: isoDate,
  verified: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  evidenceReference: optionalText(200),
  note: optionalText(500),
});

export async function recordCompletion(_prev: PeopleActionState, form: FormData): Promise<PeopleActionState> {
  const parsed = completionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const v = parsed.data;
  return call("record_training_completion", {
    p_profile: v.profileId,
    p_course: v.courseId,
    p_completed_on: v.completedOn,
    p_verified: v.verified,
    p_evidence_reference: v.evidenceReference || null,
    p_note: v.note || null,
  }, v.verified ? "Completion recorded and verified." : "Completion recorded. It counts once another admin verifies it.");
}

export async function verifyCompletion(_prev: PeopleActionState, form: FormData): Promise<PeopleActionState> {
  const id = z.string().uuid().safeParse(form.get("completionId"));
  if (!id.success) return { error: "That record was not found." };
  return call("verify_training_completion", { p_completion: id.data }, "Verified.");
}

const voidSchema = z.object({
  completionId: z.string().uuid(),
  reason: z.string().trim().min(10, "Say in a sentence why this record is wrong.").max(500),
});

export async function voidCompletion(_prev: PeopleActionState, form: FormData): Promise<PeopleActionState> {
  const parsed = voidSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  return call("void_training_completion", { p_completion: parsed.data.completionId, p_reason: parsed.data.reason }, "Record voided.");
}
