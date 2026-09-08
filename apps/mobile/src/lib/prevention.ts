import { supabase } from "./supabase";
import { todayIsoDate } from "./medications";
import type { QueryResult } from "./medications";
import type { Tables } from "@tarragon/shared";

/**
 * Native data layer for the Prevention screen — risk tiers, the screening
 * calendar, vaccination due-list/history, and lab-result trends. Mirrors the
 * read shape of the web page's components (apps/web/src/app/(dashboard)/
 * patient/(sections)/prevention/page.tsx and its risk-assessment-display.tsx,
 * preventive-screening-calendar.tsx, results-trends-card.tsx,
 * vaccination-registry.tsx) but is a fresh implementation, not a port —
 * apps/web isn't a package the mobile app can import from (worktree-isolated,
 * Next.js-only path aliases). Every query goes through the same RLS-scoped
 * client every other native screen uses; no service-role access.
 *
 * Deliberately NOT ported: the full vaccination_catalog + recommended_age
 * due/overdue/not-yet-due computation engine
 * (apps/web/src/lib/rules/vaccination-status.ts) — a substantial, genuinely
 * separate clinical rules engine (five different recommended_age shapes,
 * DOB-anchored infant schedules, booster fallback-anchoring). This screen
 * instead shows the persisted vaccination_schedules rows the engine already
 * materialised (due/overdue/booked) plus the patient's actual dose history
 * (vaccination_records) — real data, just not a re-derivation of "not yet
 * due" for every catalog entry the patient hasn't been scheduled for yet.
 * Likewise not ported: lab-order creation/partner-billing for a due
 * screening (createLabOrder, PartnerLabBillingOption) — booking a lab test
 * involves catalogue/pricing lookups and partner-billing branches genuinely
 * more involved than a single insert. What IS a single-insert action —
 * confirming a due screening was already done — is implemented natively
 * (confirmScreeningDone), mirroring confirm-screening-done-form.tsx minus
 * its optional result-document upload step.
 */

export type PreventionCondition = Tables<"prevention_risk_scores">["condition"];
export type RiskTierValue = Tables<"prevention_risk_scores">["tier"];

export const CONDITION_LABEL: Record<PreventionCondition, string> = {
  hypertension: "Hypertension",
  diabetes: "Diabetes",
  cvd: "Heart disease",
  breast_ca: "Breast cancer",
  cervical_ca: "Cervical cancer",
  colorectal_ca: "Colorectal cancer",
  prostate_ca: "Prostate cancer",
  ckd: "Kidney disease",
  asthma_copd: "Asthma / COPD",
  mental_wellbeing: "Mental wellbeing",
  other: "Other",
};

export interface RiskScoreItem {
  id: string;
  condition: PreventionCondition;
  tier: RiskTierValue;
  confidence: Tables<"prevention_risk_scores">["confidence"];
  factors: string[];
  forcedByExistingDiagnosis: boolean;
}

/** One row per condition (latest computed_at) — mirrors useRiskScores. */
export async function getRiskScores(patientId: string): Promise<QueryResult<RiskScoreItem[]>> {
  try {
    const { data, error } = await supabase
      .from("prevention_risk_scores")
      .select("id, condition, tier, confidence, inputs_snapshot, computed_at")
      .eq("profile_id", patientId)
      .order("computed_at", { ascending: false });
    if (error) return { ok: false, error: error.message };

    const latestByCondition = new Map<string, RiskScoreItem>();
    for (const row of data ?? []) {
      if (latestByCondition.has(row.condition)) continue;
      const snapshot = (row.inputs_snapshot ?? {}) as Record<string, unknown>;
      const factors = Array.isArray(snapshot.factors) ? (snapshot.factors as string[]) : [];
      latestByCondition.set(row.condition, {
        id: row.id,
        condition: row.condition,
        tier: row.tier,
        confidence: row.confidence,
        factors,
        forcedByExistingDiagnosis: snapshot.forced_by === "existing_diagnosis",
      });
    }
    return { ok: true, data: [...latestByCondition.values()] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface ScreeningItem {
  id: string;
  screenTypeId: string;
  screenTypeName: string;
  dueDate: string;
  status: Tables<"screening_schedules">["status"];
  isOverdue: boolean;
  isDue: boolean;
  isRecall: boolean;
  recallReason: string | null;
  declinedReason: string | null;
}

/** Mirrors useScreeningSchedules — every non-cancelled row, due-date order. */
export async function getScreeningSchedules(patientId: string): Promise<QueryResult<ScreeningItem[]>> {
  try {
    const { data, error } = await supabase
      .from("screening_schedules")
      .select(
        "id, due_date, status, is_recall, recall_reason, declined_reason, screen_type_id, screen_type:screen_types(id, name)"
      )
      .eq("patient_id", patientId)
      .neq("status", "cancelled")
      .order("due_date", { ascending: true });
    if (error) return { ok: false, error: error.message };

    const today = todayIsoDate();
    return {
      ok: true,
      data: (data ?? []).map((row) => {
        const isOverdue = row.due_date < today && (row.status === "pending" || row.status === "booked");
        const isDue = row.due_date <= today && (row.status === "pending" || row.status === "overdue");
        return {
          id: row.id,
          screenTypeId: row.screen_type_id,
          screenTypeName: row.screen_type?.name ?? "Screening",
          dueDate: row.due_date,
          status: row.status,
          isOverdue,
          isDue,
          isRecall: row.is_recall,
          recallReason: row.recall_reason,
          declinedReason: row.declined_reason,
        };
      }),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Confirms a due screening was already done, mirroring
 * useLogScreeningCompletion (patient-insert-own into screening_completions;
 * private.refresh_screening_schedule_on_completion closes the schedule row
 * and schedules the next cycle from performedDate). Result-document upload
 * (camera capture) is a separate, already-native path (labs.ts's
 * uploadLabResult) not wired in here — see the module note above.
 */
export async function confirmScreeningDone(
  patientId: string,
  input: { scheduleId: string | null; screenTypeId: string; performedDate: string; note?: string },
  /** Skips the profiles lookup below when the caller already has it on hand
   * (e.g. HomeShell's own organisationId prop) — purely an optimisation,
   * the insert is identical either way. */
  organisationId?: string
): Promise<QueryResult<{ id: string }>> {
  try {
    let orgId = organisationId ?? null;
    if (!orgId) {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", patientId)
        .single();
      if (profileError) return { ok: false, error: profileError.message };
      if (!profile?.organisation_id) return { ok: false, error: "This patient has no organisation on file" };
      orgId = profile.organisation_id;
    }

    const { data, error } = await supabase
      .from("screening_completions")
      .insert({
        patient_id: patientId,
        organisation_id: orgId,
        screen_type_id: input.screenTypeId,
        schedule_id: input.scheduleId,
        performed_date: input.performedDate,
        note: input.note?.trim() || null,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: { id: data.id } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Declines a recommended screening with a reason — mirrors
 * useDeclineScreeningSchedule (a plain patient-own-row UPDATE;
 * screening_schedules_declined_requires_reason and
 * private.block_screening_schedule_after_decline enforce the rest
 * server-side). Carried over from the interim native screen this file
 * replaces — dropping it would have been a real regression, not just a
 * scope trim, since it was already a working single-table action.
 */
export async function declineScreening(
  patientId: string,
  scheduleId: string,
  reason: string
): Promise<QueryResult<null>> {
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: "A reason is required" };
  try {
    const { error } = await supabase
      .from("screening_schedules")
      .update({ status: "declined", declined_at: new Date().toISOString(), declined_reason: trimmed })
      .eq("id", scheduleId)
      .eq("patient_id", patientId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface VaccinationDueItem {
  id: string;
  catalogId: string;
  name: string;
  dueDate: string;
  status: Tables<"vaccination_schedules">["status"];
}

/** Persisted pending/booked/overdue vaccination_schedules rows — see the
 * module note on why the full due/not-yet-due computation isn't ported. */
export async function getVaccinationSchedules(patientId: string): Promise<QueryResult<VaccinationDueItem[]>> {
  try {
    const { data, error } = await supabase
      .from("vaccination_schedules")
      .select("id, due_date, status, vaccination_catalog_id, vaccination_catalog:vaccination_catalog(id, name)")
      .eq("patient_id", patientId)
      .in("status", ["pending", "booked", "overdue"])
      .order("due_date", { ascending: true });
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      data: (data ?? []).map((row) => ({
        id: row.id,
        catalogId: row.vaccination_catalog_id,
        name: row.vaccination_catalog?.name ?? "Vaccination",
        dueDate: row.due_date,
        status: row.status,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface VaccinationRecordItem {
  id: string;
  name: string;
  doseNumber: number;
  dateAdministered: string;
}

/** Mirrors useVaccinationRecords, most-recent-first, capped for the screen. */
export async function getVaccinationRecords(
  patientId: string,
  limit = 20
): Promise<QueryResult<VaccinationRecordItem[]>> {
  try {
    const { data, error } = await supabase
      .from("vaccination_records")
      .select("id, dose_number, date_administered, vaccination_catalog:vaccination_catalog(name)")
      .eq("profile_id", patientId)
      .order("date_administered", { ascending: false })
      .limit(limit);
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      data: (data ?? []).map((row) => ({
        id: row.id,
        name: row.vaccination_catalog?.name ?? "Vaccination",
        doseNumber: row.dose_number,
        dateAdministered: row.date_administered,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const ANALYTE_LABEL: Record<string, string> = {
  hba1c: "HbA1c",
  fasting_glucose: "Fasting glucose",
  psa: "PSA",
  creatinine: "Creatinine",
  egfr: "eGFR",
  total_cholesterol: "Total cholesterol",
  ldl: "LDL cholesterol",
  hdl: "HDL cholesterol",
  triglycerides: "Triglycerides",
};

function labelForAnalyte(code: string): string {
  if (code in ANALYTE_LABEL) return ANALYTE_LABEL[code];
  const spaced = code.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export interface AnalyteTrendItem {
  code: string;
  label: string;
  latestValue: number;
  latestUnit: string | null;
  latestTakenAt: string;
  previousValue: number | null;
  previousTakenAt: string | null;
}

/** Mirrors ResultsTrendsCard's useAnalyteTrends — latest + previous reading
 * per analyte code, for a neutral "your numbers over time" view. No
 * good/bad verdict is rendered; that stays the reviewing doctor's job. */
export async function getAnalyteTrends(patientId: string): Promise<QueryResult<AnalyteTrendItem[]>> {
  try {
    const { data, error } = await supabase
      .from("lab_analyte_readings")
      .select("code, value, unit, taken_at")
      .eq("patient_id", patientId)
      .order("taken_at", { ascending: false })
      .limit(200);
    if (error) return { ok: false, error: error.message };

    const byCode = new Map<string, { code: string; value: number; unit: string | null; taken_at: string }[]>();
    for (const row of data ?? []) {
      // A qualitative/text-only result (value_text, no numeric value) has
      // nothing to trend or delta against — skip it rather than let a null
      // silently become NaN downstream.
      if (row.value === null) continue;
      const list = byCode.get(row.code) ?? [];
      if (list.length < 2) list.push({ ...row, value: row.value });
      byCode.set(row.code, list);
    }
    const trends = [...byCode.entries()].map(([code, readings]) => ({
      code,
      label: labelForAnalyte(code),
      latestValue: readings[0].value,
      latestUnit: readings[0].unit,
      latestTakenAt: readings[0].taken_at,
      previousValue: readings[1]?.value ?? null,
      previousTakenAt: readings[1]?.taken_at ?? null,
    }));
    trends.sort((a, b) => (a.latestTakenAt < b.latestTakenAt ? 1 : -1));
    return { ok: true, data: trends };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** "in 5 days" / "today" / "3 days overdue" — mirrors overview.ts's daysLabel
 * and care-schedule-card.tsx's original. */
export function daysLabel(dateStr: string): string {
  const today = new Date(new Date().toDateString());
  const target = new Date(new Date(dateStr).toDateString());
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  if (days === 0) return "today";
  return `${-days} day${days === -1 ? "" : "s"} overdue`;
}
