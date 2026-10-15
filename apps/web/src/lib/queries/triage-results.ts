import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { patientTriageRowSchema, type PatientTriageRow } from "@/lib/triage/explainer";

/**
 * P6: the results the engine recorded for a patient's own saved readings, by id. Row security returns only the patient's own
 * rows (triage_events_patient_read). A result graded by a rule set nobody has approved (shadow) is NOT shown: it may differ
 * from the guidance the patient was given, and "what happened with my reading" must be what they were actually told.
 */
const CHUNK = 50;

export function useOwnTriageResults(triageEventIds: readonly string[]) {
  const ids = [...new Set(triageEventIds)].sort();
  return useQuery({
    queryKey: ["own-triage-results", ids],
    queryFn: async (): Promise<Map<string, PatientTriageRow>> => {
      // Fifty ids to a request: the history grows by pages and one long id list would pass the URL limit.
      const client = createClient();
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
      const results = await Promise.all(
        chunks.map((chunk) => client.from("triage_events").select("id, grade, explanation_key, created_at").in("id", chunk).eq("shadow", false)),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
      const rows = results.flatMap((r) => r.data ?? []).flatMap((r) => {
        const parsed = patientTriageRowSchema.safeParse(r);
        return parsed.success ? [parsed.data] : [];
      });
      return new Map(rows.map((r) => [r.id, r]));
    },
    enabled: ids.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
