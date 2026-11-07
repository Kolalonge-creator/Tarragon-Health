import { z } from "zod";
import { daysUntil, type AttentionItem } from "./attention";
import type { Loaded } from "./directory";

/**
 * HR Phase B: mandatory training. The database says who must do which course and what has been recorded
 * (people_training_records, staff_training_completions); this file turns that into one status per person and course.
 * An unverified completion is never "compliant" (spec section 11), and there is no blended score that could hide one
 * person's overdue course: the headline figure is a plain count of requirements met.
 */
interface Client {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from(table: string): {
    select(cols: string): {
      eq(col: string, value: string): {
        order(col: string, o: { ascending: boolean }): PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
      order(col: string, o: { ascending: boolean }): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
  };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const trainingRecordSchema = z.object({
  profile_id: z.string().uuid(),
  course_id: z.string().uuid(),
  course_name: z.string(),
  category: z.enum(["mandatory", "professional"]),
  renewal_months: z.number().nullable(),
  due_on: isoDate,
  completion_id: z.string().uuid().nullable(),
  completed_on: isoDate.nullable(),
  expires_on: isoDate.nullable(),
  verified: z.boolean().nullable(),
});
export type TrainingRecord = z.infer<typeof trainingRecordSchema>;

export const courseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  category: z.enum(["mandatory", "professional"]),
  provider: z.string().nullable(),
  description: z.string().nullable(),
  renewal_months: z.number().nullable(),
  is_active: z.boolean(),
});
export type Course = z.infer<typeof courseSchema>;

export const requirementSchema = z.object({
  id: z.string().uuid(),
  course_id: z.string().uuid(),
  applies_to: z.enum(["everyone", "role", "department"]),
  role: z.string().nullable(),
  department_id: z.string().uuid().nullable(),
  due_within_days: z.number(),
});
export type Requirement = z.infer<typeof requirementSchema>;

export const completionSchema = z.object({
  id: z.string().uuid(),
  course_id: z.string().uuid(),
  completed_on: isoDate,
  expires_on: isoDate.nullable(),
  evidence_reference: z.string().nullable(),
  note: z.string().nullable(),
  verified_at: z.string().nullable(),
  voided_at: z.string().nullable(),
  void_reason: z.string().nullable(),
  recorded_at: z.string(),
});
export type Completion = z.infer<typeof completionSchema>;

function parsed<T>(schema: z.ZodType<T>, data: unknown, what: string): Loaded<T> {
  const r = schema.safeParse(data);
  return r.success ? { ok: true, value: r.data } : { ok: false, message: `The ${what} came back in an unexpected shape.` };
}

/** Everyone's records, or one person's when `profileId` is given. */
export async function loadTrainingRecords(client: unknown, profileId?: string): Promise<Loaded<TrainingRecord[]>> {
  const { data, error } = await (client as Client).rpc("people_training_records", profileId ? { p_profile: profileId } : {});
  if (error) return { ok: false, message: "The training records could not be loaded." };
  return parsed(z.array(trainingRecordSchema), data, "training records");
}

export async function loadCourses(client: unknown): Promise<Loaded<Course[]>> {
  const { data, error } = await (client as Client)
    .from("staff_training_courses")
    .select("id, name, category, provider, description, renewal_months, is_active")
    .order("name", { ascending: true });
  if (error) return { ok: false, message: "The training courses could not be loaded." };
  return parsed(z.array(courseSchema), data, "training courses");
}

export async function loadRequirements(client: unknown): Promise<Loaded<Requirement[]>> {
  const { data, error } = await (client as Client)
    .from("staff_training_requirements")
    .select("id, course_id, applies_to, role, department_id, due_within_days, removed_at")
    .order("created_at", { ascending: true });
  if (error) return { ok: false, message: "The training requirements could not be loaded." };
  const all = parsed(z.array(requirementSchema.extend({ removed_at: z.string().nullable() })), data, "training requirements");
  return all.ok ? { ok: true, value: all.value.filter((r) => r.removed_at === null) } : all;
}

export async function loadCompletions(client: unknown, profileId: string): Promise<Loaded<Completion[]>> {
  const { data, error } = await (client as Client)
    .from("staff_training_completions")
    .select("id, course_id, completed_on, expires_on, evidence_reference, note, verified_at, voided_at, void_reason, recorded_at")
    .eq("profile_id", profileId)
    .order("completed_on", { ascending: false });
  if (error) return { ok: false, message: "The training history could not be loaded." };
  return parsed(z.array(completionSchema), data, "training history");
}

export type TrainingStatus = "compliant" | "due_soon" | "overdue" | "pending_verification";

export const TRAINING_STATUS_LABEL: Record<TrainingStatus, string> = {
  compliant: "Compliant",
  due_soon: "Due soon",
  overdue: "Overdue",
  pending_verification: "Pending verification",
};

export const TRAINING_STATUS_BADGE: Record<TrainingStatus, "normal" | "attention" | "critical" | "info"> = {
  compliant: "normal",
  due_soon: "attention",
  overdue: "critical",
  pending_verification: "info",
};

/**
 * One requirement's status on `today`.
 *   verified, not expired       -> compliant, or due soon within `warnDays` of its expiry
 *   verified but expired        -> overdue
 *   recorded, not yet verified  -> pending verification (never compliant), even past its due date
 *   nothing recorded            -> due soon until its due date, then overdue
 */
export function trainingStatus(r: TrainingRecord, today: string, warnDays: number): TrainingStatus {
  if (r.completion_id && r.verified) {
    if (!r.expires_on) return "compliant";
    const left = daysUntil(r.expires_on, today);
    if (left < 0) return "overdue";
    return left <= warnDays ? "due_soon" : "compliant";
  }
  // A record exists; what is missing is an admin's check, so the next step is to verify it, never to record it again.
  if (r.completion_id) return "pending_verification";
  return daysUntil(r.due_on, today) < 0 ? "overdue" : "due_soon";
}

/** The date that matters for a status: the expiry for a verified record, otherwise the due date. */
export function trainingDueDate(r: TrainingRecord): string {
  return r.completion_id && r.verified && r.expires_on ? r.expires_on : r.due_on;
}

const SEVERITY: Record<TrainingStatus, number> = { overdue: 0, pending_verification: 1, due_soon: 2, compliant: 3 };

/** A person's worst status across their required courses, or null when they have none. */
export function worstStatus(statuses: TrainingStatus[]): TrainingStatus | null {
  return statuses.length === 0 ? null : [...statuses].sort((a, b) => SEVERITY[a] - SEVERITY[b])[0] ?? null;
}

export interface TrainingSummary {
  required: number;
  compliant: number;
  overdue: number;
  pendingVerification: number;
  dueSoon: number;
}

/** Plain counts of mandatory requirements, never a blended percentage that hides a person. */
export function summarise(records: TrainingRecord[], today: string, warnDays: number): TrainingSummary {
  const mandatory = records.filter((r) => r.category === "mandatory");
  const s = mandatory.map((r) => trainingStatus(r, today, warnDays));
  return {
    required: s.length,
    compliant: s.filter((x) => x === "compliant").length,
    overdue: s.filter((x) => x === "overdue").length,
    pendingVerification: s.filter((x) => x === "pending_verification").length,
    dueSoon: s.filter((x) => x === "due_soon").length,
  };
}

/** Attention items for the HR overview: overdue training (high) and records waiting for an admin to verify (low). */
export function trainingAttention(
  records: TrainingRecord[],
  people: ReadonlyMap<string, { name: string; department: string | null }>,
  today: string,
  warnDays: number,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const r of records) {
    const who = people.get(r.profile_id);
    if (!who) continue;
    const status = trainingStatus(r, today, warnDays);
    const base = { profileId: r.profile_id, name: who.name, department: who.department, href: `/admin/people/${r.profile_id}?tab=training` };
    if (status === "overdue") {
      items.push({ ...base, kind: "training_overdue", priority: r.category === "mandatory" ? "high" : "medium",
        issue: `${r.course_name} overdue`, due: trainingDueDate(r), nextAction: "Record the completion, or chase it" });
    } else if (status === "pending_verification") {
      const late = daysUntil(r.due_on, today) < 0;
      items.push({ ...base, kind: "training_pending_verification", priority: late ? "medium" : "low",
        issue: late ? `${r.course_name} recorded, waiting for verification, past its due date` : `${r.course_name} waiting for verification`,
        due: late ? r.due_on : null, nextAction: "Check the evidence and verify" });
    }
  }
  return items;
}
