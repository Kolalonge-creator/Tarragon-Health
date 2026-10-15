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
    /** S19c: when the console or device first showed this page to the clinician (null = not shown yet). */
    delivered_at: iso.nullable().default(null),
    /** S19c: set when the whole ladder ran out with nobody acknowledging. */
    expired_at: iso.nullable().default(null),
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
    expired_at: iso.nullable().default(null),
    delivered_at: iso.nullable().default(null),
    merged_count: z.number().int().min(0).default(0),
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
  /** S19c: what is still missing beyond the checklist: push_subscription, verified_email, test_page. */
  gaps: z.array(z.enum(["push_subscription", "verified_email", "test_page"])).default([]),
  objective_required: z.boolean().default(false),
  test_page_days: z.number().int().default(7),
  last_test_page_acknowledged_at: z.string().nullable().default(null),
  pending_test_page_id: z.uuid().nullable().default(null),
});
export type MyReadiness = z.infer<typeof myReadinessSchema>;

/** public.on_call_readiness_overview(): reviewers only. */
export const readinessOverviewSchema = z.array(
  z.object({
    clinician_id: z.uuid(),
    name: z.string(),
    ready: z.boolean(),
    confirmed_at: z.string().nullable(),
    gaps: z.array(z.string()).default([]),
  }),
);
export type ReadinessOverviewRow = z.infer<typeof readinessOverviewSchema>[number];

/** What a clinician reads for each gap. */
export const GAP_LABELS: Record<"push_subscription" | "verified_email" | "test_page", string> = {
  push_subscription: "Turn on notifications for Tarragon Health on your phone or browser",
  verified_email: "Confirm the email address on your account",
  test_page: "Send yourself a test page and acknowledge it",
};

/** public.paging_health(): reviewers only. */
export const pagingHealthSchema = z.object({
  engine: z.array(z.object({ component: z.string(), last_seen_at: iso, age_seconds: z.number().int(), stale: z.boolean() })),
  rota_covered: z.boolean(),
  on_call: z.array(
    z.object({
      clinician_id: z.uuid(),
      name: z.string().nullable(),
      role: z.enum(["primary", "backup"]),
      reachable: z.boolean(),
      devices: z.array(z.object({ kind: z.string(), last_seen_at: iso, last_delivered_at: iso.nullable(), silent: z.boolean() })),
    }),
  ),
  open_unacknowledged: z.number().int(),
  expired_open: z.number().int(),
});
export type PagingHealth = z.infer<typeof pagingHealthSchema>;

/**
 * The patient's latest answer about seeking care after a red alert (S13 R4, CMO Q13), from public.latest_red_patient_response().
 * No patient identity travels with it. It is information for the clinician and never stops the paging.
 */
export const redPatientResponseSchema = z
  .object({ response: z.enum(["sought_care", "could_not_get_care"]), responded_at: z.string() })
  .nullable();
export type RedPatientResponse = z.infer<typeof redPatientResponseSchema>;
