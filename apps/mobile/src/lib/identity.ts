import { supabase } from "./supabase";

export interface PatientIdentity {
  fullName: string;
  patientNumber: string | null;
  organisationId: string;
  initials: string;
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Mirrors the userName/idValue lookup in
 * apps/web/src/app/(dashboard)/layout.tsx + avatar-initials logic in
 * apps/web/src/components/shell/app-shell.tsx. */
export async function loadPatientIdentity(userId: string): Promise<PatientIdentity | null> {
  const { data } = await supabase
    .from("profiles")
    .select("full_name, patient_number, organisation_id")
    .eq("id", userId)
    .maybeSingle();
  if (!data?.full_name || !data.organisation_id) return null;
  return {
    fullName: data.full_name,
    patientNumber: data.patient_number,
    organisationId: data.organisation_id,
    initials: initialsFrom(data.full_name),
  };
}
