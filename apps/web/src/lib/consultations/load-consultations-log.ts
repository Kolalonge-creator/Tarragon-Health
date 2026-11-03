import type { createClient } from "@/lib/supabase/server";
import {
  filtersToRpcArgs,
  parseConsultationsLog,
  type ConsultationsLogFilters,
  type ConsultationsLogRow,
} from "@/lib/consultations/consultations-log";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface DoctorOption {
  id: string;
  name: string;
}

/** The log rows through public.consultations_log (admin / CMO only in the database). Null when the read failed. */
export async function loadConsultationsLog(
  supabase: Supabase,
  filters: ConsultationsLogFilters,
): Promise<ConsultationsLogRow[] | null> {
  const { data, error } = await supabase.rpc("consultations_log", filtersToRpcArgs(filters));
  if (error) return null;
  return parseConsultationsLog(data);
}

/** The organisation's clinicians, for the doctor filter. */
export async function loadDoctorOptions(supabase: Supabase, organisationId: string): Promise<DoctorOption[]> {
  const { data } = await supabase
    .from("clinical_staff")
    .select("profile_id, full_name")
    .eq("organisation_id", organisationId)
    .not("profile_id", "is", null)
    .order("full_name");
  return (data ?? [])
    .filter((d): d is { profile_id: string; full_name: string } => typeof d.profile_id === "string")
    .map((d) => ({ id: d.profile_id, name: d.full_name ?? "Clinician" }));
}
