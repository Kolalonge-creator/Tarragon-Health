import { z } from "zod";

const iso = z.string().min(10);

/** One open page of the caller, from public.my_active_pages(). patient_id is null for a level 2 row the caller has not acknowledged. */
export const activePagesSchema = z.array(
  z.object({
    page_id: z.uuid(),
    root_id: z.uuid(),
    role: z.enum(["primary", "backup", "escalation"]),
    escalation_level: z.number().int().min(0).max(2),
    sent_at: iso,
    acknowledged_at: iso.nullable(),
    patient_id: z.uuid().nullable(),
    seconds_waiting: z.number().int().min(0),
  }),
);
export type ActivePage = z.infer<typeof activePagesSchema>[number];

export const pagingOverviewSchema = z.array(
  z.object({
    root_id: z.uuid(),
    sent_at: iso,
    no_cover: z.boolean(),
    max_level: z.number().int(),
    acknowledged_at: iso.nullable(),
    acknowledged_by_name: z.string().nullable(),
    closed_at: iso.nullable(),
    backup_paged_at: iso.nullable(),
    lead_alerted_at: iso.nullable(),
    seconds_waiting: z.number().int().min(0),
  }),
);
export type PagingOverviewRow = z.infer<typeof pagingOverviewSchema>[number];
