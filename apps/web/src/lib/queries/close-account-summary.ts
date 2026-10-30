import { z } from "zod";

/**
 * What public.close_patient_account(request) returns (OQ-S04b2-2). Validated before it is shown, so a changed or empty
 * reply is reported as unreadable rather than as "nothing was removed".
 */
export const closeAccountSummarySchema = z.object({
  closed: z.boolean(),
  already_closed: z.boolean(),
  removed: z.record(z.string(), z.number()),
  ended: z.record(z.string(), z.number()),
  contact_details_removed: z.boolean().optional(),
  left_alone_append_only: z.array(z.string()).optional(),
  kept_classes: z.array(z.string()).optional(),
});

export type CloseAccountSummary = z.infer<typeof closeAccountSummarySchema>;

const LABELS: Record<string, string> = {
  account_recovery_contact_requests: "account recovery contact requests",
  bereavement_sponsor_notices: "sponsor notices",
  care_circle_check_ins: "Care Circle check-ins",
  care_circle_missed_dose_alerts: "Care Circle missed-dose alerts",
  care_circle_tasks: "Care Circle tasks",
  feature_waitlist: "waiting-list sign-ups",
  health_education_unlock_notifications: "learning notifications",
  health_report_build_failures: "report build records",
  medication_dose_reminders: "medicine reminders",
  medication_refill_reminder_rules: "refill reminder settings",
  membership_cards: "membership cards",
  nutrition_preferences: "food preferences",
  patient_home_layout: "home screen layout",
  patient_notification_preferences: "notification preferences",
  patient_reminder_group_members: "reminder groups",
  vitals_reminder_rules: "reading reminders",
  vitals_reminder_state: "reading reminder state",
  push_subscriptions: "phone and browser notification registrations",
  user_known_devices: "signed-in device list",
  notification_settings: "quiet-hours settings",
  patient_devices: "paired devices (unpaired)",
  wearable_connections: "connected apps and wearables (disconnected)",
  care_circle_members: "Care Circle members (access ended)",
  care_circle_invites: "Care Circle invitations (cancelled)",
  profile_access: "access given to or held by other people",
  care_access_requests: "pending access requests (cancelled)",
  record_shares: "record share links (revoked)",
  emergency_cards: "emergency card (revoked)",
  emergency_access_grants: "emergency access grants (revoked)",
};

function humanise(table: string): string {
  return LABELS[table] ?? table.replace(/_/g, " ");
}

/** One plain line per kind of thing that was removed or ended, with the count. */
export function closeAccountSummaryLines(summary: CloseAccountSummary): string[] {
  const lines: string[] = [];
  for (const [table, n] of Object.entries(summary.removed)) lines.push(`${n} ${humanise(table)} removed`);
  for (const [table, n] of Object.entries(summary.ended)) lines.push(`${n} ${humanise(table)}`);
  if (summary.contact_details_removed) lines.push("Contact details and sign-in removed; the login is closed");
  return lines;
}

/** What stays, in the patient's own words (the privacy page lists the same four things). */
export const CLOSE_ACCOUNT_KEPT: readonly string[] = [
  "Posted clinical records, including readings from devices already in the record",
  "The audit log",
  "Financial and payment ledger entries",
  "Consent history and this deletion record (the profile is deactivated, never deleted)",
];
