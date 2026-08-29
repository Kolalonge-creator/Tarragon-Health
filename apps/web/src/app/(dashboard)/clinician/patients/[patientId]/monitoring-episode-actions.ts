"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { startMonitoringEpisodeSchema } from "@/lib/validation/monitoring-episodes";

export type MonitoringEpisodeActionState = { error?: string; success?: boolean } | undefined;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Starts a monitoring episode + its schedule items (spec §51.3/§51.4/§51.15).
 * Clinician-authored, same app-layer clinical-staff gate as the other actions
 * on this page (recordFootAssessment, setGlucoseTarget, ...) — RLS backs it
 * up (monitoring_episodes_write requires private.is_org_staff), this is the
 * friendlier error message before that.
 */
export async function startMonitoringEpisode(
  _prev: MonitoringEpisodeActionState,
  formData: FormData
): Promise<MonitoringEpisodeActionState> {
  const raw = Object.fromEntries(formData.entries());

  let scheduleItems: unknown;
  try {
    scheduleItems = JSON.parse(String(formData.get("schedule_items_json") ?? "[]"));
  } catch {
    return { error: "Could not read the measurement schedule — please try again" };
  }

  const parsed = startMonitoringEpisodeSchema.safeParse({ ...raw, schedule_items: scheduleItems });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("id, organisation_id")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!staff) return { error: "Only a Tarragon care-team member can start a monitoring episode" };

  const { data: patient } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", parsed.data.patient_id)
    .maybeSingle();
  const organisationId = patient?.organisation_id ?? staff.organisation_id;

  const startedAt = parsed.data.started_at ? new Date(parsed.data.started_at) : new Date();
  const endsAt = parsed.data.duration_days
    ? toIsoDate(new Date(startedAt.getTime() + (parsed.data.duration_days - 1) * 86_400_000))
    : null;

  const { data: episode, error } = await supabase
    .from("monitoring_episodes")
    .insert({
      patient_id: parsed.data.patient_id,
      organisation_id: organisationId,
      care_plan_id: null,
      condition: parsed.data.condition ?? null,
      purpose: parsed.data.purpose,
      started_at: toIsoDate(startedAt),
      ends_at: endsAt,
      review_date: parsed.data.review_date || null,
      tracks_symptoms: parsed.data.tracks_symptoms ?? false,
      created_by: staff.id,
    })
    .select("id")
    .single();
  if (error || !episode) return { error: error?.message ?? "Could not start the monitoring episode" };

  const { error: itemsError } = await supabase.from("monitoring_schedule_items").insert(
    parsed.data.schedule_items.map((item) => ({
      episode_id: episode.id,
      // organisation_id/patient_id are re-derived from episode_id by
      // private.stamp_monitoring_schedule_item_episode_fields regardless of
      // what's sent here — included so the insert satisfies NOT NULL.
      organisation_id: organisationId,
      patient_id: parsed.data.patient_id,
      vital_type: item.vital_type,
      times_per_day: item.times_per_day,
      frequency_days: item.frequency_days,
      escalation_missed_threshold: item.escalation_missed_threshold,
      acceptable_range: item.acceptable_range ?? {},
    }))
  );
  if (itemsError) return { error: itemsError.message };

  revalidatePath(`/clinician/patients/${parsed.data.patient_id}`);
  return { success: true };
}

async function setEpisodeStatus(
  formData: FormData,
  status: "completed" | "cancelled"
): Promise<MonitoringEpisodeActionState> {
  const episodeId = String(formData.get("episode_id") ?? "");
  const patientId = String(formData.get("patient_id") ?? "");
  if (!episodeId || !patientId) return { error: "Missing episode" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("id")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!staff) return { error: "Only a Tarragon care-team member can update a monitoring episode" };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("monitoring_episodes")
    .update(
      status === "completed"
        ? { status: "completed", completed_at: now }
        : { status: "cancelled", cancelled_at: now }
    )
    .eq("id", episodeId);
  if (error) return { error: error.message };

  revalidatePath(`/clinician/patients/${patientId}`);
  return { success: true };
}

export async function completeMonitoringEpisode(
  _prev: MonitoringEpisodeActionState,
  formData: FormData
): Promise<MonitoringEpisodeActionState> {
  return setEpisodeStatus(formData, "completed");
}

export async function cancelMonitoringEpisode(
  _prev: MonitoringEpisodeActionState,
  formData: FormData
): Promise<MonitoringEpisodeActionState> {
  return setEpisodeStatus(formData, "cancelled");
}
