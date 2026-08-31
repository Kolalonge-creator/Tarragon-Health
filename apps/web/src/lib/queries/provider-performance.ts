import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

/**
 * Self-scoped clinician performance dashboard (Care Team / Provider Workspace
 * §5.21). Calls my_provider_performance (20260827203759) — NOT
 * analytics_doctor_performance, which is analyst-gated and de-identified for
 * a cross-org console. See that migration for exactly why revenue and
 * patient-feedback fields are flags, not numbers: neither exists in this
 * schema, and a salaried/per-caseload doctor has no per-consultation revenue
 * figure to show in the first place.
 */
export const myProviderPerformanceSchema = z.object({
  patients_assigned: z.number().default(0),
  escalations_reviewed: z.number().default(0),
  alerts_acknowledged: z.number().default(0),
  meds_confirmed: z.number().default(0),
  reviews_completed: z.number().default(0),
  avg_ack_minutes: z.number().default(0),
  avg_resolution_hours: z.number().default(0),
  sla_met_pct: z.number().nullable().default(null),
  pending_results: z.number().default(0),
  consultations_completed: z.number().default(0),
  consultations_cancelled: z.number().default(0),
  referrals_made: z.number().default(0),
  referrals_partial_attribution: z.boolean().default(true),
  revenue_applicable: z.boolean().default(false),
  patient_feedback_available: z.boolean().default(false),
});
export type MyProviderPerformance = z.infer<typeof myProviderPerformanceSchema>;

/** Empty {} comes back for a caller with no active clinical_staff row —
 * parsed the same as a fully-zeroed result via the schema's .default()s,
 * so the page can render its zero state without a special case. */
export function useMyProviderPerformance() {
  return useQuery({
    queryKey: ["provider-performance", "mine"],
    queryFn: async (): Promise<MyProviderPerformance> => {
      const { data, error } = await createClient().rpc("my_provider_performance", {});
      if (error) throw error;
      return myProviderPerformanceSchema.parse(data);
    },
  });
}
