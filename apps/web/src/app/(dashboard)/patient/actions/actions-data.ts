import { createClient } from "@/lib/supabase/server";
import type { AppIconName } from "@/lib/icons";

export type ActionItem = {
  icon: AppIconName;
  /** Plain-language type label, same philosophy as CareScheduleCard's
   * ScheduleItem — a patient shouldn't have to know the difference between a
   * "medication review" and a "preventive review" to understand what's
   * outstanding. */
  type: string;
  title: string;
  /** null for items that aren't date-driven (an awaiting-response offer, not
   * a due date) — those are always bucketed via `alwaysHighPriority`
   * instead. */
  dueDate: string | null;
  href: string;
  /** Someone is waiting on the patient's response right now (a proposed
   * video-call slot, an open medicines check-in) — these have no due date to
   * sort by and read as urgent regardless of what any date would say. */
  alwaysHighPriority?: boolean;
};

// A sane cap per source so a patient with a very long history can't turn this
// into a runaway query — this is a fuller list than the Overview cards'
// "just the nearest one", not an unbounded one.
const SOURCE_LIMIT = 30;

function formatLabel(value: string): string {
  return value.split("_").join(" ");
}

/**
 * Merges every outstanding task across the platform's scheduling subsystems
 * into one flat list for the Action Centre (spec §76.5). Fans out across the
 * same 10 distinct sources CareScheduleCard (6) and NextBestAction (5) each
 * independently query — medication_reviews is shared between those two and
 * is only queried once here — but unlike either of those cards, which each
 * only want the single nearest item per source, this fetches every
 * pending/due row so nothing outstanding is left off the page.
 */
export async function resolveActionCentreItems(patientId: string): Promise<ActionItem[]> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  // Wider than NextBestAction's 7-day refill window — this page is the full
  // list, not just "the next thing", so it can afford to surface a refill a
  // little further out.
  const in14Days = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

  const [
    medReviews,
    labMonitoring,
    preventiveReviews,
    lpeReviews,
    annualReviews,
    vaccinations,
    screenings,
    consults,
    checkins,
    refills,
  ] = await Promise.all([
    supabase
      .from("medication_reviews")
      .select("id, due_date")
      .eq("patient_id", patientId)
      .eq("status", "pending")
      .order("due_date", { ascending: true })
      .limit(SOURCE_LIMIT),
    supabase
      .from("medication_lab_monitoring")
      .select("id, due_date, monitoring_label")
      .eq("patient_id", patientId)
      .eq("status", "pending")
      .not("due_date", "is", null)
      .order("due_date", { ascending: true })
      .limit(SOURCE_LIMIT),
    supabase
      .from("preventive_reviews")
      .select("id, due_date")
      .eq("patient_id", patientId)
      .eq("status", "pending")
      .order("due_date", { ascending: true })
      .limit(SOURCE_LIMIT),
    supabase
      .from("lpe_reviews")
      .select(
        "id, due_date, enrollment:lpe_enrollments!lpe_reviews_enrollment_id_fkey(condition)"
      )
      .eq("patient_id", patientId)
      .eq("status", "pending")
      .order("due_date", { ascending: true })
      .limit(SOURCE_LIMIT),
    supabase
      .from("annual_reviews")
      .select("id, due_date")
      .eq("patient_id", patientId)
      .in("status", ["pending", "in_progress"])
      .order("due_date", { ascending: true })
      .limit(SOURCE_LIMIT),
    supabase
      .from("vaccination_schedules")
      .select(
        "id, due_date, vaccination_catalog:vaccination_catalog!vaccination_schedules_vaccination_catalog_id_fkey(name)"
      )
      .eq("patient_id", patientId)
      .in("status", ["pending", "overdue"])
      .order("due_date", { ascending: true })
      .limit(SOURCE_LIMIT),
    supabase
      .from("screening_schedules")
      .select("id, due_date, screen_type:screen_types(name)")
      .eq("patient_id", patientId)
      .in("status", ["pending", "overdue"])
      .order("due_date", { ascending: true })
      .limit(SOURCE_LIMIT),
    supabase
      .from("video_consultations")
      .select("id")
      .eq("patient_id", patientId)
      .is("patient_confirmed_at", null)
      .not("proposed_slots", "is", null)
      .neq("status", "cancelled")
      .limit(SOURCE_LIMIT),
    supabase
      .from("medication_adherence_checkins")
      .select("id")
      .eq("patient_id", patientId)
      .eq("status", "pending")
      .lte("due_date", today)
      .limit(SOURCE_LIMIT),
    supabase
      .from("medications")
      .select("id, drug_name, refill_date")
      .eq("patient_id", patientId)
      .eq("is_active", true)
      .not("refill_date", "is", null)
      .lte("refill_date", in14Days)
      .order("refill_date", { ascending: true })
      .limit(SOURCE_LIMIT),
  ]);

  const items: ActionItem[] = [];

  for (const row of medReviews.data ?? []) {
    items.push({
      icon: "medication",
      type: "Medication review",
      title: "Your medication is due for a review by your care team",
      dueDate: row.due_date,
      href: "/patient/medications",
    });
  }

  for (const row of labMonitoring.data ?? []) {
    if (!row.due_date) continue;
    items.push({
      icon: "labs",
      type: "Lab test",
      title: `${row.monitoring_label ?? "A lab test"} is coming up`,
      dueDate: row.due_date,
      href: "/patient/medications",
    });
  }

  for (const row of preventiveReviews.data ?? []) {
    items.push({
      icon: "preventive",
      type: "Prevention check-in",
      title: "A periodic health review with your care team is due",
      dueDate: row.due_date,
      href: "/patient/prevention",
    });
  }

  for (const row of lpeReviews.data ?? []) {
    const condition = (row.enrollment as { condition?: string } | null)?.condition;
    items.push({
      icon: "food",
      type: "Lifestyle coaching check-in",
      title: condition
        ? `Your ${formatLabel(condition)} lifestyle coaching review is due`
        : "Your lifestyle coaching review is due",
      dueDate: row.due_date,
      href: "/patient/care",
    });
  }

  for (const row of annualReviews.data ?? []) {
    items.push({
      icon: "carePlan",
      type: "Annual doctor review",
      title: "Your once-a-year whole-body review with a doctor is due",
      dueDate: row.due_date,
      href: "/patient/prevention",
    });
  }

  for (const row of vaccinations.data ?? []) {
    const vaccineName = (row.vaccination_catalog as { name?: string } | null)?.name;
    items.push({
      icon: "preventive",
      type: "Vaccination",
      title: vaccineName ? `${vaccineName} is due` : "A vaccination is due",
      dueDate: row.due_date,
      href: "/patient/prevention",
    });
  }

  for (const row of screenings.data ?? []) {
    const screenName = (row.screen_type as { name?: string } | null)?.name ?? "screening";
    items.push({
      icon: "preventive",
      type: "Screening",
      title: `Your ${screenName} is due`,
      dueDate: row.due_date,
      href: "/patient/prevention",
    });
  }

  const consultCount = consults.data?.length ?? 0;
  for (let i = 0; i < consultCount; i++) {
    items.push({
      icon: "booking",
      type: "Video call",
      title: "Your doctor offered times for a video call — pick one",
      dueDate: null,
      href: "/patient/care",
      alwaysHighPriority: true,
    });
  }

  const checkinCount = checkins.data?.length ?? 0;
  for (let i = 0; i < checkinCount; i++) {
    items.push({
      icon: "medication",
      type: "Medicines check-in",
      title: "A 2-minute medicines check-in is waiting",
      dueDate: null,
      href: "/patient/medications",
      alwaysHighPriority: true,
    });
  }

  for (const row of refills.data ?? []) {
    if (!row.refill_date) continue;
    items.push({
      icon: "medication",
      type: "Refill",
      title: `${row.drug_name} is due for a refill soon`,
      dueDate: row.refill_date,
      href: "/patient/medications",
    });
  }

  return items;
}

export type ActionCentreBucketKey = "highPriority" | "dueToday" | "dueThisWeek" | "upcoming";

export type BucketedActionItems = Record<ActionCentreBucketKey, ActionItem[]>;

/** null dueDate sorts first — those are always the alwaysHighPriority items
 * with no date to compare, and within High priority "awaiting you right now"
 * reads as more urgent than any dated item. */
function byDueDateAscending(a: ActionItem, b: ActionItem): number {
  if (a.dueDate === b.dueDate) return 0;
  if (a.dueDate === null) return -1;
  if (b.dueDate === null) return 1;
  return a.dueDate.localeCompare(b.dueDate);
}

/**
 * Buckets the merged list into High priority / Due today / Due this week /
 * Upcoming per spec §76.5. High priority is either an always-urgent item
 * (awaiting the patient's response) or anything already overdue; the other
 * three buckets are pure due-date windows.
 */
export function bucketActionItems(items: ActionItem[]): BucketedActionItems {
  const today = new Date().toISOString().slice(0, 10);
  const weekFromToday = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

  const buckets: BucketedActionItems = {
    highPriority: [],
    dueToday: [],
    dueThisWeek: [],
    upcoming: [],
  };

  for (const item of items) {
    if (item.alwaysHighPriority || (item.dueDate !== null && item.dueDate < today)) {
      buckets.highPriority.push(item);
    } else if (item.dueDate === today) {
      buckets.dueToday.push(item);
    } else if (item.dueDate !== null && item.dueDate <= weekFromToday) {
      buckets.dueThisWeek.push(item);
    } else {
      buckets.upcoming.push(item);
    }
  }

  buckets.highPriority.sort(byDueDateAscending);
  buckets.dueThisWeek.sort(byDueDateAscending);
  buckets.upcoming.sort(byDueDateAscending);

  return buckets;
}

/** "in 5 days" / "today" / "5 days overdue" — same shape as
 * CareScheduleCard's daysLabel, copied rather than imported since that file
 * doesn't export it. */
export function daysLabel(dateStr: string): string {
  const today = new Date(new Date().toDateString());
  const target = new Date(new Date(dateStr).toDateString());
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  if (days === 0) return "today";
  return `${-days} day${days === -1 ? "" : "s"} overdue`;
}
