import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Tables, Enums } from "@tarragon/shared";

export type TherapyProvider = Tables<"therapy_directory">;
export type TherapySession = Tables<"therapy_sessions">;

/**
 * Mirrors apps/web/src/lib/queries/therapy.ts. Reads public.therapy_directory,
 * a VIEW, never specialist_providers itself — the underlying table carries
 * contact details, licence numbers and Tarragon's commission rate, none of
 * which is a patient's business, and the view is also where "verified, in
 * date, and active" is enforced.
 *
 * ORDERING IS A PLAIN, PATIENT-CONTROLLED SORT AND MUST STAY ONE. This
 * platform has a standing guardrail against a specialist matching or ranking
 * engine. Never order by commission, and never introduce a "recommended" or
 * "best match" ordering here without an explicit founder decision.
 */
export async function loadTherapyDirectory(filters?: {
  specialistType?: Enums<"specialist_type">;
  telemedicineOnly?: boolean;
}): Promise<QueryResult<TherapyProvider[]>> {
  let query = supabase.from("therapy_directory").select("*");
  if (filters?.specialistType) query = query.eq("specialist_type", filters.specialistType);
  if (filters?.telemedicineOnly) query = query.eq("supports_telemedicine", true);
  // Alphabetical: the one ordering that cannot be accused of steering.
  const { data, error } = await query.order("name", { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as TherapyProvider[] };
}

export async function loadMyTherapySessions(): Promise<QueryResult<TherapySession[]>> {
  const { data, error } = await supabase
    .from("therapy_sessions")
    .select("*, provider:therapy_directory!inner(name, specialist_type)")
    .order("requested_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as TherapySession[] };
}

export interface RequestTherapySessionInput {
  organisationId: string;
  patientId: string;
  providerId: string;
  feeKobo: number;
  modality: Enums<"therapy_modality">;
  patientNote?: string;
}

/**
 * Request a session — a plain RLS-scoped insert, not a checkout. Everything
 * that could go wrong clinically is refused by the database, not here:
 * private.enforce_therapy_session_rules checks the practitioner is active and
 * in date, offers the modality asked for, that psychiatry waits for a doctor,
 * and — the one that matters most — that the patient does not have an open
 * crisis alert. The error message from that last rule is written to be shown
 * to the patient verbatim, which is why the caller must surface `error`
 * as-is rather than a generic "something went wrong."
 */
export async function requestTherapySession(input: RequestTherapySessionInput): Promise<QueryResult<null>> {
  const { error } = await supabase.from("therapy_sessions").insert({
    organisation_id: input.organisationId,
    patient_id: input.patientId,
    provider_id: input.providerId,
    fee_kobo: input.feeKobo,
    modality: input.modality,
    patient_note: input.patientNote ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
