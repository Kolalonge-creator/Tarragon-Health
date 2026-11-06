import "server-only";

import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { resolveServiceAccess } from "@/app/(dashboard)/patient/service-status-card";
import { bucketActionItems, resolveActionCentreItems } from "@/app/(dashboard)/patient/actions/actions-data";
import { buildCareJourney, type JourneyStage } from "@/lib/patient/care-journey";

/**
 * Everything Home's status strip, next-appointment card and care journey need (patient dashboard 2.0, spec 4.2/4.4/4.7;
 * PD-03, PD-05), read once per request for the patient whose dashboard is open.
 *
 * Every read is filtered by `patientId` under RLS, so it is correct when a supporter is acting for someone: nothing here uses a
 * `my_*` function (those answer for the signed-in person, who may be the supporter). A failed read becomes `null`, which the
 * cards show as "not available" or leave out; it never becomes a zero.
 */

/** Same statuses the appointments list calls upcoming. */
const UPCOMING_STATUSES = ["held", "booked", "confirmed", "checked_in", "in_progress"] as const;
const OPEN_TEST_STATUSES = ["pending_payment", "payment_confirmed", "ordered", "sample_collected", "processing"] as const;
/** An appointment stays "next" for an hour after its start, the same as the join window's closing minute. */
const NEXT_APPOINTMENT_GRACE_MS = 60 * 60_000;
const MONITORING_WINDOW_MS = 14 * 86_400_000;

export interface NextAppointment {
  id: string;
  scheduledFor: string;
  appointmentType: string;
  status: string;
  consultationMethod: string;
  location: string | null;
  clinicianName: string | null;
}

export interface HomeOverview {
  /** Overdue and due-today items from the Action Centre. */
  actionsDue: number | null;
  /** Results and documents waiting for a doctor. */
  resultsAwaitingDoctor: number | null;
  /** Undefined when the read failed, null when there is none. */
  nextAppointment: NextAppointment | null | undefined;
  /** A care-team reply the patient has not opened. Not computed while acting: the read marker belongs to the patient. */
  unreadCareTeamReply: boolean | null;
  journey: JourneyStage[];
}

export async function loadHomeOverview(
  patientId: string,
  known: { hasRiskAssessment: boolean; hasAnyVitals: boolean; acting: boolean },
  now: Date = new Date(),
): Promise<HomeOverview> {
  const supabase = await createClient();
  const nowMs = now.getTime();

  const [access, actionItems, appointment, baseline, carePlans, openTests, resultedTests, awaiting, reviewed, recentReading, threads, labResults] =
    await Promise.all([
      resolveServiceAccess(patientId),
      resolveActionCentreItems(patientId).catch((e: unknown) => {
        Sentry.captureException(e);
        return null;
      }),
      supabase
        .from("appointments")
        .select("id, scheduled_for, appointment_type, status, consultation_method, location, clinician:profiles!appointments_clinician_id_fkey(full_name)")
        .eq("patient_id", patientId)
        .in("status", [...UPCOMING_STATUSES])
        .gte("scheduled_for", new Date(nowMs - NEXT_APPOINTMENT_GRACE_MS).toISOString())
        .order("scheduled_for", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("preventive_baselines")
        .select("state")
        .eq("patient_id", patientId)
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("care_plans").select("id", { count: "exact", head: true }).eq("patient_id", patientId).eq("status", "active"),
      supabase.from("lab_orders").select("id", { count: "exact", head: true }).eq("patient_id", patientId).in("status", [...OPEN_TEST_STATUSES]),
      supabase.from("lab_orders").select("id", { count: "exact", head: true }).eq("patient_id", patientId).eq("status", "resulted"),
      supabase
        .from("clinical_record_items")
        .select("id", { count: "exact", head: true })
        .eq("patient_id", patientId)
        .eq("status", "doctor_review_required"),
      supabase
        .from("clinical_record_items")
        .select("id", { count: "exact", head: true })
        .eq("patient_id", patientId)
        .eq("status", "reviewed"),
      supabase
        .from("vitals_readings")
        .select("id")
        .eq("patient_id", patientId)
        // A reading marked entered in error or superseded does not count as monitoring (S05b-c).
        .is("correction_status", null)
        .gte("taken_at", new Date(nowMs - MONITORING_WINDOW_MS).toISOString())
        .limit(1)
        .maybeSingle(),
      known.acting
        ? Promise.resolve(null)
        : supabase
            .from("care_message_threads")
            .select("last_care_team_reply_at, patient_last_read_at")
            .eq("patient_id", patientId)
            .not("last_care_team_reply_at", "is", null)
            .order("last_care_team_reply_at", { ascending: false })
            .limit(20),
      // Structured and partner lab results held for review (S27) have no document row, so they are counted from the patient's own
      // results list. That function answers for the signed-in person, so it is not used while a supporter is acting.
      known.acting ? Promise.resolve(null) : supabase.rpc("my_lab_results"),
    ]);

  const failed = (
    [
      ["appointments", appointment],
      ["preventive_baselines", baseline],
      ["care_plans", carePlans],
      ["lab_orders_open", openTests],
      ["lab_orders_resulted", resultedTests],
      ["record_items_awaiting", awaiting],
      ["record_items_reviewed", reviewed],
      ["vitals", recentReading],
      ["threads", threads],
      ["my_lab_results", labResults],
    ] as const
  ).filter(([, r]) => r !== null && r.error);
  if (failed.length > 0) {
    Sentry.captureException(new Error("home-overview: read failed"), {
      extra: { failed: failed.map(([name, r]) => ({ name, message: r?.error?.message })) },
    });
  }

  const count = (r: { count: number | null; error: unknown }): number | null => (r.error ? null : (r.count ?? 0));

  const actionsDue = actionItems === null ? null : (() => {
    const b = bucketActionItems(actionItems, now);
    return b.highPriority.length + b.dueToday.length;
  })();

  const appt = appointment.data;
  const nextAppointment: NextAppointment | null | undefined = appointment.error
    ? undefined
    : appt
      ? {
          id: appt.id,
          scheduledFor: appt.scheduled_for,
          appointmentType: appt.appointment_type,
          status: appt.status,
          consultationMethod: appt.consultation_method,
          location: appt.location,
          clinicianName: appt.clinician?.full_name ?? null,
        }
      : null;

  // Held results that are not the patient's own uploads (those are already counted as documents above). Null while acting or
  // on a failed read: then only documents are counted, and the total is null if documents failed too.
  const heldLabResults =
    labResults === null || labResults.error
      ? null
      : ((labResults.data ?? []) as { status?: string; own_upload?: boolean }[]).filter(
          (r) => r.status === "under_review" && r.own_upload !== true,
        ).length;
  const documentsAwaiting = count(awaiting);
  const resultsAwaitingDoctor =
    documentsAwaiting === null ? null : documentsAwaiting + (heldLabResults ?? 0);

  const unreadCareTeamReply =
    threads === null
      ? null
      : threads.error
        ? null
        : (threads.data ?? []).some(
            (t) =>
              t.last_care_team_reply_at !== null &&
              (t.patient_last_read_at === null || Date.parse(t.last_care_team_reply_at) > Date.parse(t.patient_last_read_at)),
          );

  const baselineState = baseline.error
    ? null
    : ((baseline.data?.state ?? "none") as "none" | "submitted" | "authorised" | "adjusted");
  const activePlans = count(carePlans);

  const journey = buildCareJourney({
    isMember: access === null ? null : access.status === "membership_active",
    assessmentDone: known.hasRiskAssessment ? true : baselineState === null ? null : baselineState !== "none",
    baselineState,
    carePlanActive:
      activePlans === null ? null : activePlans > 0 || baselineState === "authorised" || baselineState === "adjusted",
    openTestCount: count(openTests),
    resultedTestCount: count(resultedTests),
    resultsAwaitingDoctor,
    resultsReviewed: count(reviewed),
    recentReading: recentReading.error ? null : !!recentReading.data,
    anyReading: known.hasAnyVitals,
  });

  return {
    actionsDue,
    resultsAwaitingDoctor,
    nextAppointment,
    unreadCareTeamReply,
    journey,
  };
}
