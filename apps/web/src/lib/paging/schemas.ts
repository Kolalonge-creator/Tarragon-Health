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

/** The on-call phone checklist (S19b). The keys are the ones the database requires; the wording is what the clinician reads. */
export const READINESS_ITEMS = {
  notifications_on: "Notifications are on for Tarragon Health and will stay on while I am on call.",
  battery_saving_off: "Battery saving is off for Tarragon Health and the app is allowed to start by itself.",
  data_and_power: "I will keep mobile data or Wi-Fi on, with a charger or power bank nearby.",
  email_opens: "The email on my account opens on my phone.",
  cover_plan: "If I cannot take a shift, I will ask a colleague to cover it before it starts.",
} as const;
export type ReadinessKey = keyof typeof READINESS_ITEMS;

/** public.my_on_call_readiness() */
export const myReadinessSchema = z.object({
  version: z.number().int(),
  items: z.array(z.string()),
  confirmed_at: z.string().nullable(),
  on_call_clinician: z.boolean(),
});
export type MyReadiness = z.infer<typeof myReadinessSchema>;

/** public.on_call_readiness_overview(): reviewers only. */
export const readinessOverviewSchema = z.array(
  z.object({ clinician_id: z.uuid(), name: z.string(), ready: z.boolean(), confirmed_at: z.string().nullable() }),
);
export type ReadinessOverviewRow = z.infer<typeof readinessOverviewSchema>[number];
