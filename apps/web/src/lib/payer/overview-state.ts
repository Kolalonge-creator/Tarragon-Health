import { z } from "zod";

const programmeSchema = z.object({
  programme_name: z.string(),
  condition: z.string(),
  members_with_condition: z.number().nullable(),
  enrolled: z.number().nullable(),
  controlled: z.number().nullable(),
  overdue_review: z.number().nullable(),
  suppressed_subgroup: z.boolean(),
});

const analyticsSchema = z.object({
  suppressed: z.boolean(),
  min_cohort_size: z.number(),
  note: z.string().optional(),
  member_count: z.number().optional(),
  programmes: z.array(programmeSchema).optional(),
});

export type PayerDashboardAnalytics = z.infer<typeof analyticsSchema>;

/**
 * What the payer overview shows, decided from the analytics RPC's reply.
 *
 * `failed` is a read that errored or came back in a shape we do not recognise.
 * It is kept apart from `suppressed`, which is the privacy rule withholding
 * figures because fewer than the minimum number of members are verified. The
 * page used to treat both as "not enough members yet", so a database error told
 * an insurer its members were too few to report on.
 */
export type PayerOverviewState =
  | { kind: "failed" }
  | { kind: "suppressed"; note: string | null; minCohortSize: number }
  | { kind: "ready"; dashboard: PayerDashboardAnalytics };

export function payerOverviewState(reply: { data: unknown; error: unknown }): PayerOverviewState {
  if (reply.error) return { kind: "failed" };
  const parsed = analyticsSchema.safeParse(reply.data);
  if (!parsed.success) return { kind: "failed" };
  if (parsed.data.suppressed) {
    return { kind: "suppressed", note: parsed.data.note ?? null, minCohortSize: parsed.data.min_cohort_size };
  }
  return { kind: "ready", dashboard: parsed.data };
}
