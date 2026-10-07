import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { loadPatientContext, type PatientContext } from "./context";

/**
 * §36.5 / §36.8 / §36.9 — the three "patient selects a quick action"
 * composed surfaces named in docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md §7
 * Phase C: "Explain my health record", "What do I need to do this month",
 * and appointment preparation.
 *
 * Deliberately deterministic, no LLM call. §36.5 asks the result to
 * "distinguish documented facts from AI interpretation" — the safest way to
 * guarantee that distinction is to not generate free text over PHI at all
 * for these three: every field below is a value read directly from the
 * patient's own record, formatted, never phrased or summarised by a model.
 * A narrated version (mirroring case_briefs/patient-explainer's proven
 * strict-grounding-with-degrade-on-failure pattern) is a reasonable future
 * increment, deliberately not built here to keep these three surfaces
 * 100% reviewable and testable without mocking an LLM.
 *
 * Each function is best-effort over loadPatientContext, which already
 * never throws — these follow the same contract.
 */

export interface HealthRecordExplanation {
  currentConditions: { conditionName: string; status: string }[];
  recentResults: { code: string; value: number | null; unit: string | null; takenAt: string }[];
  currentMedicines: { drugName: string; dose: string | null; frequency: string | null }[];
  upcomingAppointments: { scheduledFor: string; reason: string | null }[];
  activeCareGoals: { conditionLabel: string; goalTitles: string[] }[];
}

/** §36.5 — "Explain my health record". */
export function explainHealthRecord(context: PatientContext): HealthRecordExplanation {
  return {
    currentConditions: context.activeConditions,
    recentResults: context.recentLabResults,
    currentMedicines: context.activeMedications,
    upcomingAppointments: context.upcomingAppointments.map((a) => ({
      scheduledFor: a.scheduledFor,
      reason: a.reason,
    })),
    activeCareGoals: context.lifestyleProgrammes
      .filter((p) => p.goalTitles.length > 0)
      .map((p) => ({ conditionLabel: p.conditionLabel, goalTitles: p.goalTitles })),
  };
}

export type CareTaskCategory = "monitoring" | "medication" | "screening" | "appointment";

export interface CareTaskItem {
  category: CareTaskCategory;
  label: string;
  /** null when there is no meaningful "done" state to track (e.g. a
   * medication refill reminder) — render as a plain reminder, not a
   * checkbox, per §36.8's own ✓/○ example only using two states for things
   * that genuinely have one. */
  done: boolean | null;
  dueOn: string;
}

export interface CareTasksThisMonth {
  monthLabel: string;
  items: CareTaskItem[];
}

function isWithinCurrentMonth(dateStr: string, now: Date): boolean {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth();
}

/** §36.8 — "What do I need to do this month?" Pulls from vitals-monitoring
 * due dates, medication refill dates, due/overdue screenings, and
 * appointments — every table already exists (docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md
 * §2.6), this just composes them into the one checklist §36.8's own example
 * shows. Never throws — each of the three extra reads (beyond context,
 * which is already resilient) is independently guarded. */
export async function careTasksThisMonth(
  supabase: SupabaseClient<Database>,
  patientId: string,
  context: PatientContext,
  now: Date = new Date()
): Promise<CareTasksThisMonth> {
  const items: CareTaskItem[] = [];

  try {
    const { data } = await supabase
      .from("vitals_reminder_state")
      .select("next_due_at")
      .eq("patient_id", patientId)
      .maybeSingle();
    if (data && isWithinCurrentMonth(data.next_due_at, now)) {
      items.push({ category: "monitoring", label: "Log your vitals reading", done: null, dueOn: data.next_due_at });
    }
  } catch {
    // best-effort, matches loadPatientContext's own resilience contract
  }

  // context.activeMedications doesn't carry refill_date (loadPatientContext
  // trims it) -- read it directly, scoped to this month only, rather than
  // widen that shared type for one field only this surface needs.
  try {
    const { data } = await supabase
      .from("medications")
      .select("drug_name, refill_date")
      .eq("patient_id", patientId)
      .eq("is_active", true)
      .not("refill_date", "is", null);
    for (const row of data ?? []) {
      if (row.refill_date && isWithinCurrentMonth(row.refill_date, now)) {
        items.push({
          category: "medication",
          label: `Refill: ${row.drug_name}`,
          done: null,
          dueOn: row.refill_date,
        });
      }
    }
  } catch {
    // best-effort
  }

  try {
    const { data } = await supabase
      .from("screening_schedules")
      .select("due_date, status, screen_types(name)")
      .eq("patient_id", patientId);
    for (const row of data ?? []) {
      if (isWithinCurrentMonth(row.due_date, now)) {
        const label = (row.screen_types as { name: string } | null)?.name ?? "Screening";
        items.push({
          category: "screening",
          label,
          done: row.status === "completed",
          dueOn: row.due_date,
        });
      }
    }
  } catch {
    // best-effort
  }

  for (const appt of context.upcomingAppointments) {
    if (isWithinCurrentMonth(appt.scheduledFor, now)) {
      items.push({
        category: "appointment",
        label: appt.reason ? `Appointment: ${appt.reason}` : "Appointment",
        done: null,
        dueOn: appt.scheduledFor,
      });
    }
  }

  items.sort((a, b) => a.dueOn.localeCompare(b.dueOn));

  return {
    monthLabel: now.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "Africa/Lagos" }),
    items,
  };
}

export interface AppointmentPrepSummary {
  nextAppointment: { scheduledFor: string; reason: string | null } | null;
  recentSymptoms: { description: string | null; severity: number | null; reportedAt: string }[];
  recentMeasurements: { vitalType: string; value: string; unit: string | null; takenAt: string }[];
  medicationIssues: { drugName: string; issue: string }[];
  /** S51 (7.7): what changed since the last completed appointment. `lastReviewAt` is null when there has been none. */
  changesSinceLastReview: {
    lastReviewAt: string | null;
    newMedicines: string[];
    readingsLogged: number;
    symptomsLogged: number;
  };
  /** S51 (7.7): questions the patient may want to ask, each built from a fact in their own record. */
  questions: string[];
}

const RECENT_SYMPTOM_WINDOW_DAYS = 30;

/**
 * S51 (7.7): the question list is built from the patient's own record only, one rule per kind of fact. No model, no free text from
 * anywhere else, so every line can be traced to a row. It is an offer, not advice: the patient chooses what to keep.
 */
export function buildPrepQuestions(
  summary: Pick<AppointmentPrepSummary, "recentSymptoms" | "medicationIssues" | "recentMeasurements" | "changesSinceLastReview">,
  context: Pick<PatientContext, "activeConditions">
): string[] {
  const q: string[] = [];
  for (const s of summary.recentSymptoms.slice(0, 3)) {
    q.push(`I have noticed ${s.description ?? "a symptom"}${s.severity ? ` (about ${s.severity} out of 10)` : ""}. What could be behind it, and should I do anything?`);
  }
  for (const m of summary.medicationIssues) q.push(`My ${m.drugName} is due to be renewed. Can that be arranged?`);
  for (const m of summary.changesSinceLastReview.newMedicines.slice(0, 3)) q.push(`I started ${m} recently. Is it working as expected, and what should I look out for?`);
  if (summary.recentMeasurements.length > 0) q.push("Are my recent readings where you want them to be?");
  for (const c of context.activeConditions.slice(0, 2)) q.push(`What is my target for ${c.conditionName}, and what should I focus on before my next visit?`);
  q.push("Is there anything I should be doing differently, or checking more often?");
  return q.slice(0, 8);
}

/**
 * S51 (7.7, INV-11): a message the patient can read, edit and choose to send to their care team before the visit. It is a DRAFT built
 * from facts in their record. It is never sent on its own and never written to the record by the assistant; only the patient's own
 * send (a message they author) leaves the app.
 */
export function buildPrepDraft(summary: AppointmentPrepSummary): string {
  const lines: string[] = ["Hello, before my appointment I wanted to share a few things."];
  const ch = summary.changesSinceLastReview;
  if (ch.lastReviewAt) {
    lines.push(`Since my last review on ${ch.lastReviewAt.slice(0, 10)}: I logged ${ch.readingsLogged} reading(s) and ${ch.symptomsLogged} symptom note(s).`);
    if (ch.newMedicines.length > 0) lines.push(`New medicines since then: ${ch.newMedicines.join(", ")}.`);
  }
  if (summary.recentSymptoms.length > 0) {
    lines.push("Symptoms I have noticed: " + summary.recentSymptoms.slice(0, 5).map((s) => s.description ?? "a symptom").join("; ") + ".");
  }
  if (summary.medicationIssues.length > 0) {
    lines.push("Medicines I need renewed: " + summary.medicationIssues.map((m) => m.drugName).join(", ") + ".");
  }
  if (summary.questions.length > 0) {
    lines.push("My questions:");
    summary.questions.forEach((x, i) => lines.push(`${i + 1}. ${x}`));
  }
  return lines.join("\n");
}

/** §36.9 — "What should I tell my doctor?" Covers symptoms, recent
 * measurements, and medication issues (an overdue refill) from §36.9's own
 * list; "changes since previous review" and "questions" are not included —
 * the former needs a review-history read this surface doesn't have time to
 * build correctly yet, the latter is free-text generation deliberately out
 * of scope for this deterministic-only pass (see this file's top comment).
 * Never throws — each extra read is independently guarded, same as
 * careTasksThisMonth. */
export async function prepareForAppointment(
  supabase: SupabaseClient<Database>,
  patientId: string,
  context: PatientContext,
  now: Date = new Date()
): Promise<AppointmentPrepSummary> {
  const nextAppointment = context.upcomingAppointments[0]
    ? { scheduledFor: context.upcomingAppointments[0].scheduledFor, reason: context.upcomingAppointments[0].reason }
    : null;

  let recentSymptoms: AppointmentPrepSummary["recentSymptoms"] = [];
  try {
    const since = new Date(now.getTime() - RECENT_SYMPTOM_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("symptoms")
      .select("description, severity, reported_at")
      .eq("patient_id", patientId)
      .gte("reported_at", since)
      .order("reported_at", { ascending: false })
      .limit(10);
    recentSymptoms = (data ?? []).map((row) => ({
      description: row.description,
      severity: row.severity,
      reportedAt: row.reported_at,
    }));
  } catch {
    // best-effort
  }

  const recentMeasurements = context.recentVitals.map((v) => ({
    vitalType: v.vitalType,
    value: v.value,
    unit: v.unit,
    takenAt: v.takenAt,
  }));

  const todayIso = now.toISOString().slice(0, 10);
  let medicationIssues: AppointmentPrepSummary["medicationIssues"] = [];
  try {
    const { data } = await supabase
      .from("medications")
      .select("drug_name, refill_date")
      .eq("patient_id", patientId)
      .eq("is_active", true)
      .not("refill_date", "is", null)
      .lt("refill_date", todayIso);
    medicationIssues = (data ?? []).map((row) => ({
      drugName: row.drug_name,
      issue: `Refill was due ${row.refill_date}`,
    }));
  } catch {
    // best-effort
  }

  // S51 (7.7): what changed since the last completed appointment. Each read is independently guarded, like the others here.
  let lastReviewAt: string | null = null;
  let newMedicines: string[] = [];
  let readingsLogged = 0;
  let symptomsLogged = 0;
  try {
    const { data } = await supabase
      .from("appointments")
      .select("scheduled_for")
      .eq("patient_id", patientId)
      .eq("status", "completed")
      .lt("scheduled_for", now.toISOString())
      .order("scheduled_for", { ascending: false })
      .limit(1);
    lastReviewAt = data?.[0]?.scheduled_for ?? null;
  } catch {
    // best-effort
  }
  if (lastReviewAt) {
    try {
      const { data } = await supabase
        .from("medications")
        .select("drug_name")
        .eq("patient_id", patientId)
        .eq("is_active", true)
        .gt("created_at", lastReviewAt);
      newMedicines = (data ?? []).map((r) => r.drug_name);
    } catch {
      // best-effort
    }
    try {
      const { count } = await supabase
        .from("vitals_readings")
        .select("id", { count: "exact", head: true })
        .eq("patient_id", patientId)
        .gt("taken_at", lastReviewAt);
      readingsLogged = count ?? 0;
    } catch {
      // best-effort
    }
    try {
      const { count } = await supabase
        .from("symptoms")
        .select("id", { count: "exact", head: true })
        .eq("patient_id", patientId)
        .gt("reported_at", lastReviewAt);
      symptomsLogged = count ?? 0;
    } catch {
      // best-effort
    }
  }
  const changesSinceLastReview = { lastReviewAt, newMedicines, readingsLogged, symptomsLogged };
  const questions = buildPrepQuestions({ recentSymptoms, medicationIssues, recentMeasurements, changesSinceLastReview }, context);

  return { nextAppointment, recentSymptoms, recentMeasurements, medicationIssues, changesSinceLastReview, questions };
}

/** Convenience wrapper — loads context once and runs all three composed
 * surfaces against it, for callers (e.g. the quick-action buttons) that
 * only need to make one loadPatientContext call. */
export async function loadComposedSurfaceContext(
  supabase: SupabaseClient<Database>,
  patientId: string
): Promise<PatientContext> {
  return loadPatientContext(supabase, patientId);
}
