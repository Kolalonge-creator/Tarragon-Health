import type { EscalationStatus, ReferralStatus, Tables } from "@tarragon/shared";
import { supabase } from "./supabase";
import type { QueryResult } from "./medications";

// ---------------------------------------------------------------------------
// Care plan (mirrors apps/web/src/app/(dashboard)/patient/my-care-plan-tasks.tsx)
// ---------------------------------------------------------------------------

export interface CarePlanSummaryItem {
  id: string;
  condition: string;
  clinicianName: string | null;
  targetRanges: [string, string][];
  notes: string | null;
}

function humanize(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export { humanize as humanizeCareLabel };

/** Active care plans + the name-only clinician lookup RPC (my_care_plan_clinicians) —
 * mirrors useCarePlans on web, minus hasScheduledReview (that's the
 * multi_condition_review upsell, out of scope for this pass). */
export async function getCarePlans(patientId: string): Promise<QueryResult<CarePlanSummaryItem[]>> {
  try {
    const [{ data: plans, error: plansError }, { data: names, error: namesError }] = await Promise.all([
      supabase
        .from("care_plans")
        .select("id, condition, target_ranges, notes, assigned_clinician_id")
        .eq("patient_id", patientId)
        .eq("status", "active")
        .order("created_at", { ascending: false }),
      supabase.rpc("my_care_plan_clinicians"),
    ]);
    if (plansError) return { ok: false, error: plansError.message };
    if (namesError) return { ok: false, error: namesError.message };

    const nameByPlanId = new Map((names ?? []).map((n) => [n.care_plan_id, n.clinician_full_name]));

    return {
      ok: true,
      data: (plans ?? []).map((plan) => {
        const targetRanges = (plan.target_ranges ?? {}) as Record<string, unknown>;
        return {
          id: plan.id,
          condition: humanize(plan.condition),
          clinicianName: plan.assigned_clinician_id ? nameByPlanId.get(plan.id) ?? null : null,
          targetRanges: Object.entries(targetRanges).map(
            ([key, value]) => [humanize(key), String(value)] as [string, string]
          ),
          notes: plan.notes,
        };
      }),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type CareTask = Tables<"care_tasks">;

/** A patient's own care-plan tasks — mirrors useCareTasks on web. Bucketing
 * into Overdue/Today/This week/Upcoming happens in the screen, same split as
 * web's groupCareTasksByBucket. */
export async function getCareTasks(patientId: string): Promise<QueryResult<CareTask[]>> {
  try {
    const { data, error } = await supabase
      .from("care_tasks")
      .select("*")
      .eq("patient_id", patientId)
      .order("due_at", { ascending: true, nullsFirst: false });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: data ?? [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The only way a patient moves their own task — care_tasks carries no
 * patient UPDATE policy, this always goes through public.complete_care_task().
 * Mirrors useCompleteCareTask on web. */
export async function completeCareTask(
  taskId: string,
  status: "in_progress" | "completed" | "unable_to_complete",
  unableReason?: string
): Promise<QueryResult<null>> {
  try {
    const { error } = await supabase.rpc("complete_care_task", {
      p_task_id: taskId,
      p_status: status,
      p_unable_reason: unableReason || undefined,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type CarePlanGoal = Tables<"care_plan_goals">;

/** Mirrors useCarePlanGoals on web. Read-only here — proposing a new goal is
 * a web-only affordance for this first native pass (a form on top of an
 * already sizeable screen); the RPC/table itself is unchanged. */
export async function getCareGoals(patientId: string): Promise<QueryResult<CarePlanGoal[]>> {
  try {
    const { data, error } = await supabase
      .from("care_plan_goals")
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: (data ?? []).filter((g) => g.status === "open" || g.status === "proposed") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const OPEN_TASK_STATUSES = new Set(["not_started", "scheduled", "in_progress", "missed"]);

export interface CareTaskBuckets {
  overdue: CareTask[];
  today: CareTask[];
  thisWeek: CareTask[];
  upcoming: CareTask[];
}

/** Mirrors apps/web/src/lib/rules/care-task-buckets.ts's groupCareTasksByBucket
 * exactly — an undated task lands in Upcoming rather than disappearing. */
export function bucketCareTasks(tasks: CareTask[], now: Date): CareTaskBuckets {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const weekEnd = new Date(todayStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const buckets: CareTaskBuckets = { overdue: [], today: [], thisWeek: [], upcoming: [] };
  for (const task of tasks) {
    if (!OPEN_TASK_STATUSES.has(task.status)) continue;
    if (!task.due_at) {
      buckets.upcoming.push(task);
      continue;
    }
    const dueAt = new Date(task.due_at);
    if (task.status === "missed" || dueAt < todayStart) {
      buckets.overdue.push(task);
    } else if (dueAt < tomorrowStart) {
      buckets.today.push(task);
    } else if (dueAt < weekEnd) {
      buckets.thisWeek.push(task);
    } else {
      buckets.upcoming.push(task);
    }
  }
  return buckets;
}

/** Mirrors the RequiresEntitlement("clinician_review") gate around
 * MyCarePlanTasks on web — a doctor-set, doctor-reviewed care plan is a paid
 * service; see UpgradePrompt's clinician_review copy. */
export async function hasCarePlanAccess(): Promise<QueryResult<boolean>> {
  try {
    const { data, error } = await supabase.rpc("has_feature_access", { feature: "clinician_review" });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: Boolean(data) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Care follow-ups / escalations (mirrors apps/web/src/components/patient-escalations.tsx)
// ---------------------------------------------------------------------------

export interface EscalationItem {
  id: string;
  reason: string;
  status: EscalationStatus;
  createdAt: string;
  slaDueAt: string | null;
}

export async function getEscalations(patientId: string): Promise<QueryResult<EscalationItem[]>> {
  try {
    const { data, error } = await supabase
      .from("escalations")
      .select("id, reason, status, created_at, clinician_alert:clinician_alerts(sla_due_at)")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false });
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      data: (data ?? []).map((row) => ({
        id: row.id,
        reason: row.reason,
        status: row.status,
        createdAt: row.created_at,
        slaDueAt: row.clinician_alert?.sla_due_at ?? null,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Mirrors apps/web/src/lib/escalations/what-happens-next.ts exactly — the
 * real sla_due_at the escalation engine computes, never a fabricated number. */
export function whatHappensNext(status: EscalationStatus, slaDueAt: string | null): string | null {
  if (status !== "open" && status !== "under_review") return null;
  if (slaDueAt && new Date(slaDueAt).getTime() > Date.now()) {
    return `Your care team aims to get back to you by ${formatDueBy(slaDueAt)}.`;
  }
  return "Your care team is following up on this as a priority.";
}

function formatDueBy(slaDueAt: string): string {
  return new Date(slaDueAt).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const ESCALATION_STATUS_COPY: Record<EscalationStatus, string> = {
  open: "We're looking into this",
  under_review: "Being reviewed by your care team",
  resolved: "Reviewed",
  referred: "Referred for further care",
};

// ---------------------------------------------------------------------------
// Specialist referrals (mirrors apps/web/src/components/your-referrals.tsx)
// ---------------------------------------------------------------------------

export interface ReferralItem {
  id: string;
  specialistType: string;
  status: ReferralStatus;
  appointmentDate: string | null;
  providerName: string | null;
  createdAt: string;
  carePlanUpdateNote: string | null;
}

export async function getReferrals(patientId: string): Promise<QueryResult<ReferralItem[]>> {
  try {
    const { data, error } = await supabase
      .from("specialist_referrals")
      .select(
        "id, specialist_type, status, appointment_date, created_at, care_plan_update_note, specialist_provider:specialist_providers!specialist_referrals_specialist_provider_id_fkey(name)"
      )
      .eq("patient_id", patientId)
      .neq("status", "draft")
      .order("created_at", { ascending: false });
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      data: (data ?? []).map((row) => ({
        id: row.id,
        specialistType: row.specialist_type,
        status: row.status,
        appointmentDate: row.appointment_date,
        providerName: row.specialist_provider?.name ?? null,
        createdAt: row.created_at,
        carePlanUpdateNote: row.care_plan_update_note,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Never actually shown — the query above excludes drafts — but
// Record<ReferralStatus, ...> still needs every key so a future status can't
// silently fall through unhandled. Mirrors your-referrals.tsx exactly.
export const REFERRAL_STATUS_COPY: Record<ReferralStatus, string> = {
  draft: "Not yet submitted",
  pending: "Your care team is arranging this",
  pending_payment: "Ready to book (payment needed)",
  payment_confirmed: "Payment received, booking your appointment",
  booked: "Appointment booked",
  confirmed: "Confirmed",
  completed: "Visit complete",
  closed: "Closed: your care plan has been updated",
  declined: "Cancelled",
  waitlisted: "Your care team is finding the right specialist for you",
};

// ---------------------------------------------------------------------------
// Hospital admissions (mirrors apps/web/src/app/(dashboard)/patient/hospital-admissions-card.tsx)
// ---------------------------------------------------------------------------

export type HospitalAdmission = Tables<"patient_hospital_admissions">;

export async function getHospitalAdmissions(patientId: string): Promise<QueryResult<HospitalAdmission[]>> {
  try {
    const { data, error } = await supabase
      .from("patient_hospital_admissions")
      .select("*")
      .eq("patient_id", patientId)
      .order("admitted_on", { ascending: false })
      .limit(50);
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: data ?? [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface LogHospitalAdmissionInput {
  patientId: string;
  organisationId: string;
  admittedOn: string;
  dischargedOn?: string | null;
  facilityName?: string | null;
  selfReportedDiagnosis?: string | null;
}

/** Mirrors logHospitalAdmission (apps/web/src/app/(dashboard)/patient/actions.ts) —
 * a BEFORE INSERT trigger raises a clinician_review alert (not an emergency)
 * so a doctor reviews the care plan; that happens in the database, not here. */
export async function logHospitalAdmission(input: LogHospitalAdmissionInput): Promise<QueryResult<null>> {
  try {
    const { error } = await supabase.from("patient_hospital_admissions").insert({
      patient_id: input.patientId,
      organisation_id: input.organisationId,
      admitted_on: input.admittedOn,
      discharged_on: input.dischargedOn || null,
      facility_name: input.facilityName || null,
      self_reported_diagnosis: input.selfReportedDiagnosis || null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Mirrors updateHospitalAdmission — a patient marking their own current
 * admission discharged. RLS restricts the update to the caller's own row;
 * the BEFORE UPDATE guard preserves every staff/system-owned field. */
export async function markAdmissionDischarged(
  id: string,
  dischargedOn: string,
  dischargeSummary?: string
): Promise<QueryResult<null>> {
  try {
    const { error } = await supabase
      .from("patient_hospital_admissions")
      .update({ discharged_on: dischargedOn, discharge_summary: dischargeSummary || null })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function admissionDurationLabel(admission: HospitalAdmission): string {
  const start = new Date(admission.admitted_on);
  const end = admission.discharged_on ? new Date(admission.discharged_on) : new Date();
  const days = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  const unit = days === 1 ? "day" : "days";
  return admission.discharged_on ? `${days} ${unit}` : `${days} ${unit} so far`;
}

export function formatCareDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" });
}

/** YYYY-MM-DD for today in Africa/Lagos — mirrors todayIsoDate in lib/medications.ts
 * but kept local since hospital-admission dates use a plain date (not a
 * dose-slot timestamp). */
export function todayDateInput(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}
