"use server";

import { revalidatePath } from "next/cache";
import { ageFromDateOfBirth } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generateVaccinationScheduleBestEffort } from "@/lib/preventive/generate-vaccination-schedule";
import { vaccinationVerificationDecisionSchema } from "@/lib/validation/vaccination";

export type VerificationActionResult = { error?: string; success?: boolean };

/**
 * A Tarragon doctor adjudicates a patient-uploaded physical certificate.
 *
 * On 'verified': the record's Tarragon certificate serial + verified_by/at are
 * stamped by the enforce_vaccination_verification trigger (server-derived, not
 * trusted from here), the linked appointment is closed, the next dose is
 * scheduled, and the patient is notified.
 *
 * The write runs through the acting clinician's own RLS-scoped session so
 * auth.uid() (and therefore verified_by) is genuinely them. Verifying is a
 * clinical judgement, so it is gated on an active clinical_staff record —
 * a Care Coordinator (org staff but non-clinical) is excluded here, the same
 * app-layer clinical-authority pattern used for medications/protocols.
 */
export async function decideVaccinationVerification(input: {
  recordId: string;
  decision: "verified" | "rejected";
  note?: string;
}): Promise<VerificationActionResult> {
  const parsed = vaccinationVerificationDecisionSchema.safeParse({
    record_id: input.recordId,
    decision: input.decision,
    note: input.note,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { record_id: recordId, decision, note } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  // App-layer clinical-authority gate: only an active clinical_staff member
  // (a doctor) may verify a dose — not a Care Coordinator or other org staff.
  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("id")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!staff) {
    return { error: "Only a Tarragon care-team doctor can verify a vaccination certificate" };
  }

  const { data: record, error: recordError } = await supabase
    .from("vaccination_records")
    .select(
      "id, organisation_id, profile_id, vaccination_catalog_id, verification_status, booking_request_id",
    )
    .eq("id", recordId)
    .maybeSingle();
  if (recordError || !record) return { error: "Record not found" };
  if (record.verification_status !== "pending_verification") {
    return { error: "This certificate has already been reviewed" };
  }

  const { error: updateError } = await supabase
    .from("vaccination_records")
    .update({
      verification_status: decision,
      verification_note: note ?? null,
    })
    .eq("id", recordId);
  if (updateError) return { error: updateError.message };

  if (decision === "verified") {
    // Close the appointment this dose was booked under (appointment -> record).
    if (record.booking_request_id) {
      await supabase
        .from("booking_requests")
        .update({ status: "completed" })
        .eq("id", record.booking_request_id);
    }

    // Roll the schedule forward to the next dose + notify the patient. These
    // are best-effort side effects — a failure never un-verifies the dose.
    await issueCertificateSideEffects(record.profile_id, record.organisation_id, record.id);
  }

  revalidatePath("/clinician/vaccinations");
  return { success: true };
}

/**
 * Post-verification side effects (schedule the next dose, notify the patient).
 * Runs through the service-role client because it writes the engine-computed
 * schedule projection + queues notifications — never a patient-trusted value.
 * Best-effort: swallows errors so verification itself always stands.
 */
async function issueCertificateSideEffects(
  patientId: string,
  organisationId: string,
  recordId: string,
): Promise<void> {
  try {
    const service = createServiceRoleClient();

    const { data: patient } = await service
      .from("profiles")
      .select("full_name, date_of_birth, sex")
      .eq("id", patientId)
      .maybeSingle();

    // (Re)generate the persisted schedule so the completed dose rolls forward
    // and the next dose (if any) becomes a reminder-bearing pending row.
    await generateVaccinationScheduleBestEffort({
      patientId,
      organisationId,
      ageYears: ageFromDateOfBirth(patient?.date_of_birth ?? null),
      dateOfBirth: patient?.date_of_birth ?? null,
      sex: patient?.sex ?? null,
    });

    const { data: record } = await service
      .from("vaccination_records")
      .select("vaccination_catalog_id, tarragon_certificate_serial, vaccination_catalog(name)")
      .eq("id", recordId)
      .maybeSingle();

    // The next active scheduled dose for this same vaccine, if the series
    // continues — surfaced to the patient in the confirmation.
    const { data: nextSchedule } = await service
      .from("vaccination_schedules")
      .select("due_date")
      .eq("patient_id", patientId)
      .eq("vaccination_catalog_id", record?.vaccination_catalog_id ?? "")
      .in("status", ["pending", "booked"])
      .order("due_date", { ascending: true })
      .limit(1)
      .maybeSingle();

    const payload = {
      patient_name: patient?.full_name ?? "there",
      vaccine_name: record?.vaccination_catalog?.name ?? "your vaccination",
      certificate_serial: record?.tarragon_certificate_serial ?? "",
      next_dose_date: nextSchedule?.due_date ?? null,
    };

    // Confirmation only (WhatsApp + email) — never gates anything.
    await service.from("notifications").insert([
      {
        organisation_id: organisationId,
        recipient_id: patientId,
        channel: "whatsapp",
        template: "vaccination_verified",
        payload,
      },
      {
        organisation_id: organisationId,
        recipient_id: patientId,
        channel: "email",
        template: "vaccination_verified",
        payload,
      },
    ]);
  } catch {
    // Best-effort — verification already stands.
  }
}
