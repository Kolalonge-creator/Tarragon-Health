import { z } from "zod";

/**
 * S16-S20 W6.3: the care funnel read (public.care_funnel_metrics), parsed. A reply that does not match is shown as "could not be read",
 * never as a half page of healthy-looking numbers. The database returns counts and ratios only: no clinician, no patient.
 */
const ratio = z.number().nullable();

export const careFunnelSchema = z.object({
  days: z.number(),
  since: z.string(),
  alerts: z.number(),
  pages: z.number(),
  doctor_reviews: z.number(),
  emergencies: z.number(),
  ratios: z.object({ pages_per_alert: ratio, reviews_per_alert: ratio, emergencies_per_alert: ratio }),
  continuity: z.object({
    completed_with_lead: z.number(),
    handled_by_lead: z.number(),
    share: ratio,
    completed_without_lead: z.number(),
    fallback_reasons: z.record(z.string(), z.number()),
  }),
});
export type CareFunnel = z.infer<typeof careFunnelSchema>;

export function parseCareFunnel(raw: unknown): CareFunnel | null {
  const parsed = careFunnelSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Plain words for the fallback reasons the database names. An unknown reason is shown as it came, never hidden. */
export const FALLBACK_LABEL: Record<string, string> = {
  lead_handed_back: "The lead handed the task back",
  lead_claim_expired: "The lead's hold ran out",
  escalated: "The task was escalated first",
  offer_not_taken: "The offer to the lead was not taken in time",
};

export function percent(value: number | null): string {
  return value === null ? "No data yet" : `${Math.round(value * 1000) / 10}%`;
}

export function perAlert(value: number | null): string {
  return value === null ? "No alerts in this period" : value.toFixed(2);
}
