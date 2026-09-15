import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { SectionId } from "./sections";

export type ActionItem = {
  icon: string;
  type: string;
  title: string;
  dueDate: string | null;
  target: SectionId;
  alwaysHighPriority?: boolean;
};

const SOURCE_LIMIT = 30;

function formatLabel(value: string): string {
  return value.split("_").join(" ");
}

/**
 * Mirrors apps/web/src/app/(dashboard)/patient/actions/actions-data.ts's
 * resolveActionCentreItems — same 10 sources, same merge. `href` (a web
 * route) becomes `target` (a native SectionId) since every destination this
 * page links to — medications, prevention, care — is already a native
 * section here.
 */
export async function loadActionCentreItems(patientId: string): Promise<QueryResult<ActionItem[]>> {
  const today = new Date().toISOString().slice(0, 10);
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
      .select("id, due_date, enrollment:lpe_enrollments!lpe_reviews_enrollment_id_fkey(condition)")
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

  const firstError =
    medReviews.error ||
    labMonitoring.error ||
    preventiveReviews.error ||
    lpeReviews.error ||
    annualReviews.error ||
    vaccinations.error ||
    screenings.error ||
    consults.error ||
    checkins.error ||
    refills.error;
  if (firstError) return { ok: false, error: firstError.message };

  const items: ActionItem[] = [];

  for (const row of medReviews.data ?? []) {
    items.push({
      icon: "medkit-outline",
      type: "Medication review",
      title: "Your medication is due for a review by your care team",
      dueDate: row.due_date,
      target: "medications",
    });
  }

  for (const row of labMonitoring.data ?? []) {
    if (!row.due_date) continue;
    items.push({
      icon: "flask-outline",
      type: "Lab test",
      title: `${row.monitoring_label ?? "A lab test"} is coming up`,
      dueDate: row.due_date,
      target: "medications",
    });
  }

  for (const row of preventiveReviews.data ?? []) {
    items.push({
      icon: "shield-checkmark-outline",
      type: "Prevention check-in",
      title: "A periodic health review with your care team is due",
      dueDate: row.due_date,
      target: "prevention",
    });
  }

  for (const row of lpeReviews.data ?? []) {
    const condition = (row.enrollment as { condition?: string } | null)?.condition;
    items.push({
      icon: "leaf-outline",
      type: "Lifestyle coaching check-in",
      title: condition
        ? `Your ${formatLabel(condition)} lifestyle coaching review is due`
        : "Your lifestyle coaching review is due",
      dueDate: row.due_date,
      target: "care",
    });
  }

  for (const row of annualReviews.data ?? []) {
    items.push({
      icon: "clipboard-outline",
      type: "Annual doctor review",
      title: "Your once-a-year whole-body review with a doctor is due",
      dueDate: row.due_date,
      target: "prevention",
    });
  }

  for (const row of vaccinations.data ?? []) {
    const vaccineName = (row.vaccination_catalog as { name?: string } | null)?.name;
    items.push({
      icon: "shield-checkmark-outline",
      type: "Vaccination",
      title: vaccineName ? `${vaccineName} is due` : "A vaccination is due",
      dueDate: row.due_date,
      target: "prevention",
    });
  }

  for (const row of screenings.data ?? []) {
    const screenName = (row.screen_type as { name?: string } | null)?.name ?? "screening";
    items.push({
      icon: "shield-checkmark-outline",
      type: "Screening",
      title: `Your ${screenName} is due`,
      dueDate: row.due_date,
      target: "prevention",
    });
  }

  const consultCount = consults.data?.length ?? 0;
  for (let i = 0; i < consultCount; i++) {
    items.push({
      icon: "calendar-outline",
      type: "Video call",
      title: "Your doctor offered times for a video call: pick one",
      dueDate: null,
      target: "care",
      alwaysHighPriority: true,
    });
  }

  const checkinCount = checkins.data?.length ?? 0;
  for (let i = 0; i < checkinCount; i++) {
    items.push({
      icon: "medkit-outline",
      type: "Medicines check-in",
      title: "A 2-minute medicines check-in is waiting",
      dueDate: null,
      target: "medications",
      alwaysHighPriority: true,
    });
  }

  for (const row of refills.data ?? []) {
    if (!row.refill_date) continue;
    items.push({
      icon: "medkit-outline",
      type: "Refill",
      title: `${row.drug_name} is due for a refill soon`,
      dueDate: row.refill_date,
      target: "medications",
    });
  }

  return { ok: true, data: items };
}

export type ActionCentreBucketKey = "highPriority" | "dueToday" | "dueThisWeek" | "upcoming";
export type BucketedActionItems = Record<ActionCentreBucketKey, ActionItem[]>;

function byDueDateAscending(a: ActionItem, b: ActionItem): number {
  if (a.dueDate === b.dueDate) return 0;
  if (a.dueDate === null) return -1;
  if (b.dueDate === null) return 1;
  return a.dueDate.localeCompare(b.dueDate);
}

export function bucketActionItems(items: ActionItem[]): BucketedActionItems {
  const today = new Date().toISOString().slice(0, 10);
  const weekFromToday = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

  const buckets: BucketedActionItems = { highPriority: [], dueToday: [], dueThisWeek: [], upcoming: [] };

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

/** "in 5 days" / "today" / "5 days overdue" — mirrors daysLabel in
 * actions-data.ts. */
export function daysLabel(dateStr: string): string {
  const today = new Date(new Date().toDateString());
  const target = new Date(new Date(dateStr).toDateString());
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  if (days === 0) return "today";
  return `${-days} day${days === -1 ? "" : "s"} overdue`;
}
