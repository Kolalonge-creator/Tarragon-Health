import { z } from "zod";

const countsByStatus = z.record(z.string(), z.number());

const analyticsSchema = z.object({
  staff_by_role: countsByStatus,
  structure: z.object({
    locations: z.number(),
    departments: z.number(),
    services: z.number(),
    resources: z.number(),
  }),
  referrals_by_status: countsByStatus,
  referral_avg_response_hours: z.number(),
});

export type ProviderOrgAnalytics = z.infer<typeof analyticsSchema>;

/**
 * Referral statuses where the organisation still has something to do. A
 * referral that is paid and waiting, waitlisted, or booked is open; one that is
 * completed, closed, declined, still awaiting payment or only a draft is not.
 * The overview used to call the sum of every status "Open referrals", which
 * counted finished work as the queue.
 */
export const OPEN_REFERRAL_STATUSES = ["payment_confirmed", "pending", "waitlisted", "booked", "confirmed"] as const;

/** Statuses a referral can only reach after a booking was confirmed, the only ones the response-time average is built from. */
const BOOKED_STATUSES = ["booked", "confirmed", "completed", "closed"] as const;

function total(counts: Record<string, number>, statuses?: readonly string[]): number {
  return Object.entries(counts)
    .filter(([status]) => !statuses || statuses.includes(status))
    .reduce((sum, [, n]) => sum + n, 0);
}

export type ProviderOverview =
  | { kind: "failed" }
  | {
      kind: "ready";
      analytics: ProviderOrgAnalytics;
      staff: number;
      openReferrals: number;
      /** null when no referral has been booked yet: the database reports 0 for "nothing to average", which is not a 0-hour response. */
      avgResponseHours: number | null;
    };

export function providerOverview(reply: { data: unknown; error: unknown }): ProviderOverview {
  if (reply.error) return { kind: "failed" };
  const parsed = analyticsSchema.safeParse(reply.data);
  if (!parsed.success) return { kind: "failed" };
  const a = parsed.data;
  return {
    kind: "ready",
    analytics: a,
    staff: total(a.staff_by_role),
    openReferrals: total(a.referrals_by_status, OPEN_REFERRAL_STATUSES),
    avgResponseHours: total(a.referrals_by_status, BOOKED_STATUSES) > 0 ? a.referral_avg_response_hours : null,
  };
}
