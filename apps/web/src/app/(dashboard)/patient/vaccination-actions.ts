"use server";

import { revalidatePath } from "next/cache";
import { ageFromDateOfBirth } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { generateVaccinationScheduleBestEffort } from "@/lib/preventive/generate-vaccination-schedule";
import { setVaccinationNonAdministration } from "@/lib/vaccination/set-non-administration";
import { declineVaccinationSchema } from "@/lib/validation/vaccination";

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
    .select("organisation_id, date_of_birth")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) return;

  await generateVaccinationScheduleBestEffort({
    patientId: user.id,
    organisationId: profile.organisation_id,
    ageYears: ageFromDateOfBirth(profile.date_of_birth),
  });
}

export type DeclineVaccinationResult = { error?: string; success?: boolean };

/**
 * Records the patient's (or a 'manage'-level caregiver's) informed decline of
 * a due/overdue vaccine (spec §43.3). Runs through the caller's own session —
 * private.enforce_vaccination_non_administration derives who/when and moves
 * the schedule row to 'cancelled' so it stops generating reminders.
 */
export async function declineVaccinationAction(input: {
  patientId: string;
  vaccinationCatalogId: string;
  note?: string;
}): Promise<DeclineVaccinationResult> {
  const parsed = declineVaccinationSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const result = await setVaccinationNonAdministration({
    patientId: parsed.data.patientId,
    vaccinationCatalogId: parsed.data.vaccinationCatalogId,
    reason: "declined",
    note: parsed.data.note,
  });
  if (result.error) return { error: result.error };

  revalidatePath("/patient");
  return { success: true };
}
