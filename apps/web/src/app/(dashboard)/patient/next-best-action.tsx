import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAssistantOffered } from "@/lib/ai-coach/offered";
import { SEMANTIC_ICON, APP_ICON } from "@/lib/icons";
import { t, type MessageKey } from "@tarragon/i18n";
import { lagosLocalDate, addDays, LAGOS_OFFSET_MS } from "@tarragon/medicines";
import { buildTodaysDoseChecklist } from "@/lib/medication-schedule/checklist";
import { NEXT_ACTION_COPY_SLUG, pickNextAction, type NextAction } from "@/lib/patient/next-action-priority";

/**
 * "Next best action" -- the ONE card at the top of the patient dashboard (design principle 1: Home shows one next action). Pure synthesis
 * over data the patient already owns under RLS; nothing new is computed or stored. The order is fixed code (see
 * lib/patient/next-action-priority.ts), never chosen by AI, and the emergency surfaces (EmergencyAlert / DangerSymptomCheck) always render
 * above this card, so it never competes with an emergency and never carries clinical wording of its own.
 */
/** Data + date work lives outside the component body (react-hooks/purity). */
async function resolveNextAction(patientId: string): Promise<NextAction> {
  const supabase = await createClient();
  const nowMs = Date.now();
  // Due dates are Lagos calendar dates (Africa/Lagos), never the UTC date.
  const lagosToday = lagosLocalDate(nowMs);
  const today = lagosToday;
  const in7days = addDays(lagosToday, 7);
  const sevenDaysAgo = new Date(nowMs - 7 * 86400_000).toISOString();
  const lagosNowHm = new Date(nowMs + LAGOS_OFFSET_MS).toISOString().slice(11, 16);

  const [redAlert, activeMeds, doseLogs, screening, consult, checkin, review, refill, recentVital, lesson] = await Promise.all([
    supabase
      .from("emergency_events")
      .select("id")
      .eq("patient_id", patientId)
      .eq("status", "active")
      .is("acknowledged_at", null)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("medications")
      .select("id, drug_name, schedule_times, schedule_spec")
      .eq("patient_id", patientId)
      .eq("is_active", true),
    supabase
      .from("medication_logs_latest_per_slot")
      .select("medication_id, scheduled_time, status")
      .eq("patient_id", patientId)
      .eq("scheduled_for_date", lagosToday),
    supabase
      .from("screening_schedules")
      .select("id, due_date, screen_type:screen_types(name)")
      .eq("patient_id", patientId)
      .in("status", ["pending", "overdue"])
      .lte("due_date", today)
      .order("due_date", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("video_consultations")
      .select("id")
      .eq("patient_id", patientId)
      .is("patient_confirmed_at", null)
      .not("proposed_slots", "is", null)
      .neq("status", "cancelled")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("medication_adherence_checkins")
      .select("id")
      .eq("patient_id", patientId)
      .eq("status", "pending")
      .lte("due_date", today)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("medication_reviews")
      .select("id, due_date")
      .eq("patient_id", patientId)
      .eq("status", "pending")
      .lte("due_date", today)
      .order("due_date", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("medications")
      .select("id, drug_name, refill_date")
      .eq("patient_id", patientId)
      .eq("is_active", true)
      .not("refill_date", "is", null)
      .lte("refill_date", in7days)
      .order("refill_date", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("vitals_readings")
      .select("id")
      .eq("patient_id", patientId)
      .gte("taken_at", sevenDaysAgo)
      .limit(1)
      .maybeSingle(),
    supabase.rpc("weekly_micro_lesson"),
  ]);

  // A failed read must not look like "nothing waiting". Log it and let pickNextAction avoid the all-clear.
  const failed = [redAlert, activeMeds, doseLogs, screening, consult, checkin, review, refill, recentVital, lesson].filter((r) => r.error);
  if (failed.length > 0) console.error("next-best-action: query failed", failed.map((r) => r.error?.message));

  // A dose is due when a slot today has passed (Lagos clock) and is still pending. Same checklist the Today list uses.
  const checklist = buildTodaysDoseChecklist(activeMeds.data ?? [], doseLogs.data ?? [], nowMs);
  const hasDoseDue = checklist.some((item) => item.status === "pending" && item.time <= lagosNowHm);
  const weeklyLesson = ((lesson.data ?? []) as { code?: string | null; completed_this_week?: boolean | null; members_only?: boolean | null }[])[0];

  return pickNextAction({
    hasUnansweredRedAlert: !!redAlert.data,
    hasDoseDue,
    readingDue: !recentVital.data,
    refillDrugName: refill.data?.drug_name ?? null,
    screeningName: screening.data ? (screening.data.screen_type?.name ?? "screening") : null,
    hasConsultSlotsOffered: !!consult.data,
    hasCheckinOpen: !!checkin.data,
    hasReviewDue: !!review.data,
    dataUnavailable: failed.length > 0,
    lessonReady: !!weeklyLesson?.code && weeklyLesson.completed_this_week !== true && weeklyLesson.members_only !== true,
  });
}

/**
 * The action zone of the Overview's hero band (see overview-hero.tsx) — the
 * deep-green gradient half carrying the same real, priority-ordered "next
 * best step" computed above. No rounded corners of its own: the band clips
 * both zones to one rounded-2xl shape.
 */
export async function NextBestAction({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const [action, coachAccess] = await Promise.all([resolveNextAction(patientId), isAssistantOffered(supabase)]);
  const Icon = APP_ICON[action.icon] ?? SEMANTIC_ICON.preventive;
  const slug = NEXT_ACTION_COPY_SLUG[action.kind];
  const copy = (part: "title" | "body" | "cta") => t(`dp.next.${slug}.${part}` as MessageKey, "en", action.params);

  return (
    <div className="flex h-full flex-col justify-center gap-4 bg-gradient-to-br from-deep-forest to-brand-green p-6 text-white sm:p-8">
      <div className="flex min-w-0 items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-white/80" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-white/70">
            {t("dp.next.label")}
          </p>
          <p className="font-heading text-lg font-semibold sm:text-xl">{copy("title")}</p>
          <p className="max-w-xl text-sm text-white/80">{copy("body")}</p>
          {/* §78.3 -- a conversational alternative to this deterministic card,
              for a patient who'd rather ask than click through. */}
          {coachAccess && (
            <Link href="/patient/care#ai-coach" className="inline-block text-xs text-white/70 underline">
              Or ask your AI Coach what to do today
            </Link>
          )}
        </div>
      </div>
      <Link
        href={action.href}
        className="inline-flex w-fit shrink-0 items-center justify-center rounded-lg bg-white dark:bg-night-card px-5 py-2.5 text-sm font-semibold text-deep-forest dark:text-brand-green-bright transition-colors hover:bg-white/90 dark:hover:bg-night-ground/90"
      >
        {copy("cta")}
      </Link>
    </div>
  );
}
