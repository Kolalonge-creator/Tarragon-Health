import { supabase } from "./supabase";
import { loadTodaysDoses, type QueryResult } from "./medications";

export interface SummaryStats {
  latestBp: { systolic: number; diastolic: number } | null;
  latestGlucoseMmolL: number | null;
  activeMedicationCount: number;
  dosesTaken: number;
  dosesTotal: number;
  /** When the most recent vitals reading of any type was taken, or null if
   * none exists — lets Overview's "Next best step" say "log a reading"
   * only when there genuinely isn't a fresh one. */
  lastVitalTakenAt: string | null;
}

/** Mirrors getPatientSummaryStats in apps/web/src/app/(dashboard)/patient/summary.ts.
 * Returns a discriminated result rather than data-or-zeros: a failed fetch
 * must never render as "Active meds 0" or an empty dose checklist. */
export async function getSummaryStats(patientId: string): Promise<QueryResult<SummaryStats>> {
  try {
    const [bpRes, glucoseRes, medsRes, latestRes, doses] = await Promise.all([
      supabase
        .from("vitals_readings")
        .select("systolic, diastolic")
        .eq("patient_id", patientId)
        .eq("vital_type", "blood_pressure")
        .order("taken_at", { ascending: false })
        .limit(1),
      supabase
        .from("vitals_readings")
        .select("glucose_mmol_l")
        .eq("patient_id", patientId)
        .eq("vital_type", "glucose")
        .order("taken_at", { ascending: false })
        .limit(1),
      supabase.from("medications").select("id").eq("patient_id", patientId).eq("is_active", true),
      supabase
        .from("vitals_readings")
        .select("taken_at")
        .eq("patient_id", patientId)
        .order("taken_at", { ascending: false })
        .limit(1),
      loadTodaysDoses(patientId),
    ]);

    const failure = bpRes.error ?? glucoseRes.error ?? medsRes.error ?? latestRes.error;
    if (failure) return { ok: false, error: failure.message };
    if (!doses.ok) return { ok: false, error: doses.error };

    const bp = bpRes.data?.[0];
    const glucose = glucoseRes.data?.[0];

    return {
      ok: true,
      data: {
        latestBp:
          bp && bp.systolic !== null && bp.diastolic !== null
            ? { systolic: bp.systolic, diastolic: bp.diastolic }
            : null,
        latestGlucoseMmolL: glucose?.glucose_mmol_l ?? null,
        activeMedicationCount: medsRes.data?.length ?? 0,
        dosesTaken: doses.data.filter((d) => d.status === "taken").length,
        dosesTotal: doses.data.length,
        lastVitalTakenAt: latestRes.data?.[0]?.taken_at ?? null,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface CareTeamInfo {
  clinicianName: string;
  credential: string | null;
  clinicianProfileId: string;
}

/** Mirrors YourCareTeam in apps/web/src/components/your-care-team.tsx, minus
 * the care-coordinator name (that lookup needs the service-role client, which
 * the mobile app correctly has no access to — coordinator contact stays a
 * WebView-only surface for now). clinicianName/credential exist here purely
 * as the same existence-check web performs (does an active assignment exist
 * at all) — like web, the Overview card must never render this as a named
 * "your doctor" ahead of a review actually happening; see overview-screen.tsx.
 * ok:true with data:null means "no assignment"; ok:false means "unknown". */
export async function getCareTeam(patientId: string): Promise<QueryResult<CareTeamInfo | null>> {
  try {
    const { data: assignment, error: assignmentError } = await supabase
      .from("care_team_assignment")
      .select("clinician_id")
      .eq("patient_id", patientId)
      .maybeSingle();
    if (assignmentError) return { ok: false, error: assignmentError.message };
    if (!assignment?.clinician_id) return { ok: true, data: null };

    const { data: clinician, error: clinicianError } = await supabase
      .from("clinical_staff")
      .select("full_name, credential_type, credential_number")
      .eq("profile_id", assignment.clinician_id)
      .eq("active", true)
      .maybeSingle();
    if (clinicianError) return { ok: false, error: clinicianError.message };
    if (!clinician) return { ok: true, data: null };

    return {
      ok: true,
      data: {
        clinicianName: clinician.full_name,
        credential:
          clinician.credential_type && clinician.credential_number
            ? `${clinician.credential_type} ${clinician.credential_number}`
            : null,
        clinicianProfileId: assignment.clinician_id,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface ScheduleItem {
  type: string;
  title: string;
  dueDate: string;
}

const MAX_SCHEDULE_ITEMS = 6;

/** Mirrors resolveUpcomingSchedule in
 * apps/web/src/app/(dashboard)/patient/care-schedule-card.tsx — pure
 * RLS-scoped reads, no side effects, safe to fan out from the mobile client. */
export async function getCareSchedule(patientId: string): Promise<QueryResult<ScheduleItem[]>> {
  try {
    const [medReview, labMonitoring, preventiveReview, annualReview, vaccination] = await Promise.all([
      supabase
        .from("medication_reviews")
        .select("due_date")
        .eq("patient_id", patientId)
        .eq("status", "pending")
        .order("due_date", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("medication_lab_monitoring")
        .select("due_date, monitoring_label")
        .eq("patient_id", patientId)
        .eq("status", "pending")
        .not("due_date", "is", null)
        .order("due_date", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("preventive_reviews")
        .select("due_date")
        .eq("patient_id", patientId)
        .eq("status", "pending")
        .order("due_date", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("annual_reviews")
        .select("due_date")
        .eq("patient_id", patientId)
        .in("status", ["pending", "in_progress"])
        .order("due_date", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("vaccination_schedules")
        .select("due_date, vaccination_catalog:vaccination_catalog!vaccination_schedules_vaccination_catalog_id_fkey(name)")
        .eq("patient_id", patientId)
        .in("status", ["pending", "overdue"])
        .order("due_date", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    const failure =
      medReview.error ?? labMonitoring.error ?? preventiveReview.error ?? annualReview.error ?? vaccination.error;
    if (failure) return { ok: false, error: failure.message };

    const items: ScheduleItem[] = [];
    if (medReview.data) {
      items.push({
        type: "Medication review",
        title: "Your medication is due for a review by your care team",
        dueDate: medReview.data.due_date,
      });
    }
    if (labMonitoring.data?.due_date) {
      items.push({
        type: "Lab test",
        title: `${labMonitoring.data.monitoring_label ?? "A lab test"} is coming up`,
        dueDate: labMonitoring.data.due_date,
      });
    }
    if (preventiveReview.data) {
      items.push({
        type: "Prevention check-in",
        title: "A periodic health review with your care team is due",
        dueDate: preventiveReview.data.due_date,
      });
    }
    if (annualReview.data) {
      items.push({
        type: "Annual doctor review",
        title: "Your once-a-year whole-body review with a doctor is due",
        dueDate: annualReview.data.due_date,
      });
    }
    if (vaccination.data) {
      const vaccineName = (vaccination.data.vaccination_catalog as { name?: string } | null)?.name;
      items.push({
        type: "Vaccination",
        title: vaccineName ? `${vaccineName} is due` : "A vaccination is due",
        dueDate: vaccination.data.due_date,
      });
    }
    return { ok: true, data: items.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, MAX_SCHEDULE_ITEMS) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** "in 5 days" / "today" / "3 days overdue" — mirrors care-schedule-card.tsx's daysLabel. */
export function daysLabel(dateStr: string): string {
  const today = new Date(new Date().toDateString());
  const target = new Date(new Date(dateStr).toDateString());
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  if (days === 0) return "today";
  return `${-days} day${days === -1 ? "" : "s"} overdue`;
}

export interface UpcomingVideoVisit {
  scheduledAt: string;
  joinUrl: string | null;
}

/** Mirrors useUpcomingVideoVisits in apps/web/src/lib/queries/consult-slots.ts
 * — the patient's own next booked "book a video visit" check-in (general
 * check-ins only, not the Annual Health Review's video slot). Surfaced on
 * Overview so joining is one tap from the screen a patient opens most,
 * rather than requiring a detour through the Care & support WebView first —
 * see MOBILE_APP_SPEC.md §8's "one tap from the appointment reminder into a
 * working call" framing. Joining itself deep-links via Linking.openURL on
 * join_url, a standard Zoom Universal/App Link that opens the native Zoom
 * app if installed and falls back to the Zoom web client otherwise — the
 * same handoff the WebView's own onShouldStartLoadWithRequest already does
 * for a join link tapped inside /patient/care. */
export async function getUpcomingVideoVisit(patientId: string): Promise<QueryResult<UpcomingVideoVisit | null>> {
  try {
    const { data, error } = await supabase
      .from("video_consultations")
      .select("scheduled_at, join_url, status")
      .eq("patient_id", patientId)
      .eq("context", "general_checkin")
      .gte("scheduled_at", new Date().toISOString())
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data?.scheduled_at) return { ok: true, data: null };
    return { ok: true, data: { scheduledAt: data.scheduled_at, joinUrl: data.join_url } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface RecentActivityItem {
  id: string;
  title: string;
  occurredAt: string;
}

/** Lightweight slice of patient_timeline for the Overview "Recent activity"
 * card — mirrors apps/web/src/components/patient-timeline.tsx's query,
 * trimmed to what the compact native card shows. */
export async function getRecentActivity(
  patientId: string,
  limit = 5
): Promise<QueryResult<RecentActivityItem[]>> {
  try {
    const { data, error } = await supabase
      .from("patient_timeline")
      .select("id, title, occurred_at")
      .eq("patient_id", patientId)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      data: (data ?? []).map((row) => ({ id: row.id, title: row.title, occurredAt: row.occurred_at })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
