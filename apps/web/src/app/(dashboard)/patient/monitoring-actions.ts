"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { monitoringMissedReasonSchema } from "@/lib/validation/monitoring-episodes";

export type MonitoringMissedReasonActionState = { error?: string; success?: boolean } | undefined;

/**
 * Spec §51.11's "reason requested" step. Deliberately the direct signed-in
 * patient only (auth.uid() = the schedule item's own patient_id, per
 * monitoring_missed_reasons_insert's RLS check) — a supporter acting for
 * someone they care for cannot yet log a missed-reading reason on their
 * behalf; only the reading itself carries that "acting for" allowance today.
 * organisation_id/episode_id/patient_id are all server-stamped by
 * private.stamp_monitoring_missed_reason_fields, never trusted from the
 * client — this only sends schedule_item_id/reason/note.
 */
export async function logMonitoringMissedReason(
  _prev: MonitoringMissedReasonActionState,
  formData: FormData
): Promise<MonitoringMissedReasonActionState> {
  const parsed = monitoringMissedReasonSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  // episode_id/organisation_id/patient_id are re-derived from
  // schedule_item_id by private.stamp_monitoring_missed_reason_fields
  // regardless of what's sent — read here only to satisfy the Insert type
  // and to fail with a clear message rather than a bare RLS-denial if the
  // item doesn't exist or isn't this patient's (RLS itself is the real
  // enforcement — this is a friendlier error before that).
  const { data: item } = await supabase
    .from("monitoring_schedule_items")
    .select("episode_id, organisation_id, patient_id")
    .eq("id", parsed.data.schedule_item_id)
    .maybeSingle();
  if (!item) return { error: "That measurement schedule could not be found" };

  const { error } = await supabase.from("monitoring_missed_reasons").upsert(
    {
      schedule_item_id: parsed.data.schedule_item_id,
      episode_id: item.episode_id,
      organisation_id: item.organisation_id,
      patient_id: item.patient_id,
      reason: parsed.data.reason,
      note: parsed.data.note ?? null,
    },
    { onConflict: "schedule_item_id,occurred_on" }
  );
  if (error) return { error: error.message };

  revalidatePath("/patient/vitals");
  return { success: true };
}
