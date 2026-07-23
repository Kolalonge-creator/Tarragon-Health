"use server";

import { ageFromDateOfBirth } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { generateVaccinationScheduleBestEffort } from "@/lib/preventive/generate-vaccination-schedule";

/**
 * Regenerates the caller's persisted vaccination_schedules from the current
 * catalogue + their logged doses. Called after a dose is logged so a completed
 * dose rolls the schedule (and its reminder) forward. Best-effort — the log
 * itself has already succeeded before this runs; a failure here is silent.
 */
export async function syncVaccinationScheduleAction(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id, date_of_birth, sex")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) return;

  await generateVaccinationScheduleBestEffort({
    patientId: user.id,
    organisationId: profile.organisation_id,
    ageYears: ageFromDateOfBirth(profile.date_of_birth),
    dateOfBirth: profile.date_of_birth,
    sex: profile.sex,
  });
}
