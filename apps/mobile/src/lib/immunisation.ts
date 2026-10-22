import { buildImmunisationCard, type ImmunisationCard } from "@tarragon/shared";
import { supabase } from "./supabase";

export type ImmunisationResult = { ok: true; card: ImmunisationCard } | { ok: false };

/**
 * The phone's read-only immunisation summary (S09y): the vaccination module's own records and next doses, shaped by the same pure builder the web page
 * uses. A failed read is `{ ok: false }`, never an empty card, which would read as "no vaccinations".
 */
export async function loadImmunisationCard(patientId: string): Promise<ImmunisationResult> {
  const [records, schedules] = await Promise.all([
    supabase
      .from("vaccination_records")
      .select("id, dose_number, date_administered, provider, verification_status, tarragon_certificate_serial, vaccination_catalog(name)")
      .eq("profile_id", patientId)
      .order("date_administered", { ascending: true }),
    supabase
      .from("vaccination_schedules")
      .select("due_date, vaccination_catalog(name)")
      .eq("patient_id", patientId)
      .in("status", ["pending", "booked"])
      .is("non_administration_reason", null)
      .order("due_date", { ascending: true }),
  ]);
  if (records.error || schedules.error) return { ok: false };
  return {
    ok: true,
    card: buildImmunisationCard(
      (records.data ?? []).map((r) => ({
        id: r.id,
        vaccine: r.vaccination_catalog?.name ?? "Vaccine",
        doseNumber: r.dose_number,
        dateAdministered: r.date_administered,
        provider: r.provider,
        verificationStatus: r.verification_status,
        certificateSerial: r.tarragon_certificate_serial,
      })),
      (schedules.data ?? []).map((s) => ({ vaccine: s.vaccination_catalog?.name ?? "Vaccine", dueDate: s.due_date })),
    ),
  };
}
