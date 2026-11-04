import { z } from "zod";
import type { MessageKey } from "@tarragon/i18n";

/** Care Circle P5: the shape of public.admin_care_circle_metrics. A missing count reads as 0; a wrong shape reads as "could not load". */
const count = z.number().catch(0);
export const careCircleMetricsSchema = z.object({
  adoption: z.object({
    patients_with_circle: count,
    active_supporters: count,
    invites_sent: count,
    invites_accepted: count,
    patients_with_two_or_more: count,
    supporters_of_two_or_more: count,
  }),
  engagement: z.object({
    supporters_who_looked_30d: count,
    doctor_notes_released_30d: count,
    help_requests_30d: count,
    help_requests_done_30d: count,
  }),
  commercial: z.object({
    gifts_paid: count,
    gifts_accepted: count,
    gifts_waiting: count,
    gifts_declined: count,
    gifts_not_answered: count,
    gift_revenue_kobo: count,
  }),
  safety: z.object({
    removed_30d: count,
    paused_now: count,
    help_alerts_30d: count,
  }),
});
export type CareCircleMetrics = z.infer<typeof careCircleMetricsSchema>;
type Group = keyof CareCircleMetrics;

export function parseCareCircleMetrics(data: unknown): (CareCircleMetrics & Record<Group, Record<string, number>>) | null {
  const r = careCircleMetricsSchema.safeParse(data);
  return r.success ? (r.data as CareCircleMetrics & Record<Group, Record<string, number>>) : null;
}

const field = (key: string): { key: string; labelKey: MessageKey } => ({ key, labelKey: `circlep5.admin.${key}` as MessageKey });

/** The order the page shows the figures in. Every key here is a field of the schema above (a test holds them in step). */
export const METRIC_GROUPS: readonly { group: Group; titleKey: MessageKey; fields: readonly { key: string; labelKey: MessageKey }[] }[] = [
  { group: "adoption", titleKey: "circlep5.admin.adoption", fields: ["patients_with_circle", "active_supporters", "invites_sent", "invites_accepted", "patients_with_two_or_more", "supporters_of_two_or_more"].map(field) },
  { group: "engagement", titleKey: "circlep5.admin.engagement", fields: ["supporters_who_looked_30d", "doctor_notes_released_30d", "help_requests_30d", "help_requests_done_30d"].map(field) },
  { group: "commercial", titleKey: "circlep5.admin.commercial", fields: ["gifts_paid", "gifts_accepted", "gifts_waiting", "gifts_declined", "gifts_not_answered", "gift_revenue_kobo"].map(field) },
  { group: "safety", titleKey: "circlep5.admin.safety", fields: ["removed_30d", "paused_now", "help_alerts_30d"].map(field) },
];
