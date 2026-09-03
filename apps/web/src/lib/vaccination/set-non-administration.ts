import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Records a patient's decline or a clinician's contraindication finding
 * against a vaccine (spec §43.3). Targets the persisted
 * vaccination_schedules row the due/overdue engine already maintains for a
 * due/overdue vaccine; if none exists yet (e.g. the projection hasn't run
 * for this patient), one is created first via the service-role client — that
 * insert is a plain, unopinionated "there is now a row to act on", not the
 * decline/contraindicate decision itself.
 *
 * The actual field update runs through the ACTING user's own RLS-scoped
 * session (never service role), so private.enforce_vaccination_non_administration
 * derives real, un-spoofable attribution and enforces that only a
 * clinical-tier care-team member may set 'contraindicated' — this function
 * only routes the write; it is not itself the authorization boundary.
 */
export async function setVaccinationNonAdministration(input: {
  patientId: string;
  vaccinationCatalogId: string;
  reason: "declined" | "contraindicated";
  note?: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: existing, error: existingError } = await supabase
    .from("vaccination_schedules")
    .select("id")
    .eq("patient_id", input.patientId)
    .eq("vaccination_catalog_id", input.vaccinationCatalogId)
    .in("status", ["pending", "booked"])
    .maybeSingle();
  if (existingError) return { error: existingError.message };

  let scheduleId = existing?.id ?? null;

  if (!scheduleId) {
    const { data: patient, error: patientError } = await supabase
      .from("profiles")
      .select("organisation_id")
      .eq("id", input.patientId)
      .maybeSingle();
    if (patientError) return { error: patientError.message };
    if (!patient?.organisation_id) return { error: "This patient has no organisation on file" };

    const service = createServiceRoleClient();
    const { data: created, error: createError } = await service
      .from("vaccination_schedules")
      .insert({
        organisation_id: patient.organisation_id,
        patient_id: input.patientId,
        vaccination_catalog_id: input.vaccinationCatalogId,
        status: "pending",
        due_date: new Date().toISOString().slice(0, 10),
      })
      .select("id")
      .single();
    if (createError || !created) {
      return { error: createError?.message ?? "Could not create a schedule row to update" };
    }
    scheduleId = created.id;
  }

  const { error: updateError } = await supabase
    .from("vaccination_schedules")
    .update({
      non_administration_reason: input.reason,
      non_administration_note: input.note?.trim() || null,
    })
    .eq("id", scheduleId);
  if (updateError) return { error: updateError.message };

  return {};
}
