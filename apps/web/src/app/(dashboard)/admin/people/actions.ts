"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { CHANGE_KINDS, EMPLOYMENT_STATUSES, ENGAGEMENTS, NOTE_REQUIRED_KINDS, WORK_PATTERNS } from "@/lib/people/directory";
import { safePeopleError } from "./people-errors";

/**
 * HR Phase A writes (decisions HR-01 to HR-04). Every rule is enforced in the database functions (admin only, appointment
 * first, no reporting loops, a note for suspensions and leaving, history never overwritten, a clinician's employed or
 * contracted status stays on clinical_staff, only an admin sets an ID number). These actions validate the form and pass a
 * database refusal through as plain words. None of them changes platform access.
 */
export type PeopleActionState = { error?: string; message?: string } | undefined;

interface Rpc {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

const optionalUuid = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().uuid().optional());
const optionalDate = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional());
const optionalText = (max: number) => z.preprocess((v) => (v === null ? undefined : v), z.string().trim().max(max).optional());

const employmentSchema = z
  .object({
    profileId: z.string().uuid(),
    changeKind: z.enum(CHANGE_KINDS),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date the change takes effect."),
    jobTitle: z.string().trim().min(2, "Give a job title.").max(120),
    workPattern: z.enum(WORK_PATTERNS),
    employmentStatus: z.enum(EMPLOYMENT_STATUSES),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the employment start date."),
    departmentId: optionalUuid,
    lineManagerId: optionalUuid,
    engagement: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.enum(ENGAGEMENTS).optional()),
    contractEndDate: optionalDate,
    hours: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().min(0).max(80).optional()),
    workLocation: optionalText(120),
    note: optionalText(1000),
  })
  .superRefine((v, ctx) => {
    if (NOTE_REQUIRED_KINDS.includes(v.changeKind) && (v.note ?? "").length < 10) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "Add a note of at least 10 characters explaining this change." });
    }
    if (v.contractEndDate && v.contractEndDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["contractEndDate"], message: "The contract end date is before the start date." });
    }
  });

export async function recordEmploymentChange(_prev: PeopleActionState, form: FormData): Promise<PeopleActionState> {
  const parsed = employmentSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const v = parsed.data;
  const supabase = (await createClient()) as unknown as Rpc;
  const { error } = await supabase.rpc("record_staff_employment_change", {
    p_profile: v.profileId,
    p_change_kind: v.changeKind,
    p_effective_from: v.effectiveFrom,
    p_job_title: v.jobTitle,
    p_work_pattern: v.workPattern,
    p_employment_status: v.employmentStatus,
    p_start_date: v.startDate,
    p_department: v.departmentId ?? null,
    p_line_manager: v.lineManagerId ?? null,
    p_engagement: v.engagement ?? null,
    p_contract_end_date: v.contractEndDate ?? null,
    p_contracted_hours: v.hours ?? null,
    p_work_location: v.workLocation || null,
    p_note: v.note || null,
  });
  if (error) return { error: safePeopleError(error) };
  revalidatePath("/admin/people", "layout");
  return { message: "Saved to their employment history." };
}

const departmentSchema = z.object({
  id: optionalUuid,
  name: z.string().trim().min(2, "Give the department a name.").max(80),
  description: optionalText(500),
  headId: optionalUuid,
  active: z.preprocess((v) => v !== "false", z.boolean()),
});

export async function saveDepartment(_prev: PeopleActionState, form: FormData): Promise<PeopleActionState> {
  const parsed = departmentSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const v = parsed.data;
  const supabase = (await createClient()) as unknown as Rpc;
  const { error } = await supabase.rpc("save_staff_department", {
    p_id: v.id ?? null,
    p_name: v.name,
    p_description: v.description || null,
    p_head: v.headId ?? null,
    p_active: v.active,
  });
  if (error) return { error: safePeopleError(error) };
  revalidatePath("/admin/people", "layout");
  return { message: v.id ? "Department updated." : "Department added." };
}

const personalSchema = z.object({
  profileId: z.string().uuid(),
  emergencyName: optionalText(120),
  emergencyRelationship: optionalText(60),
  emergencyPhone: z.preprocess(
    (v) => (typeof v === "string" ? v.replace(/\s/g, "") : v),
    z.union([z.literal(""), z.string().regex(/^\+[1-9][0-9]{7,14}$/, "Give the phone number in international form, for example +2348031234567.")]).optional()
  ),
  homeAddress: optionalText(400),
  nationalId: z.preprocess(
    (v) => (typeof v === "string" ? v.replace(/\s/g, "") : v),
    z.union([z.literal(""), z.string().regex(/^\d{11}$/, "A national ID number (NIN) is 11 digits.")]).optional()
  ),
});

export async function savePersonalDetails(_prev: PeopleActionState, form: FormData): Promise<PeopleActionState> {
  const parsed = personalSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const v = parsed.data;
  const supabase = (await createClient()) as unknown as Rpc;
  const { error } = await supabase.rpc("set_staff_personal_details", {
    p_profile: v.profileId,
    p_emergency_contact_name: v.emergencyName || null,
    p_emergency_contact_relationship: v.emergencyRelationship || null,
    p_emergency_contact_phone: v.emergencyPhone || null,
    p_home_address: v.homeAddress || null,
    p_national_id_number: v.nationalId || null,
  });
  if (error) return { error: safePeopleError(error) };
  revalidatePath(`/admin/people/${v.profileId}`);
  return { message: "Personal details saved." };
}
