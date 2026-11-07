import { parseJourneySummary, type JourneySummary } from "@tarragon/shared";
import { loose } from "@/lib/clinician/loose-client";

/**
 * The CMO's org-wide patient journey (public.cmo_patient_journey_summary, 2026-11-07): counts, oldest ages and medians, no patient
 * identity. The function is not in the generated types yet (types are spliced, never regenerated wholesale), so it goes through the
 * loose client and is parsed. Null when the call fails or the answer is malformed: the page says "could not be loaded", never 0.
 */
export async function loadJourneySummary(client: unknown): Promise<JourneySummary | null> {
  const { data, error } = await loose(client).rpc("cmo_patient_journey_summary");
  if (error) return null;
  return parseJourneySummary(data);
}
