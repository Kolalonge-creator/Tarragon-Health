import { getProposedConfig } from "../proposed-config";

/** Deletion and retention (decision B3 and C). Deletable by the person after a grace window; clinician-recorded or acted-on data is sealed. */
export const TRACKER_DELETION_SCOPES = ["feed_log", "child_growth", "baby_checks", "pregnancy_loss"] as const;
export type TrackerDeletionScope = (typeof TRACKER_DELETION_SCOPES)[number];

export function retentionRules(): { graceDays: number; sealedRetentionYears: number; scopes: readonly string[]; version: number } {
  const c = getProposedConfig<Record<string, number | readonly string[]>>("maternal_child.retention.rules");
  const v = c.value as { grace_days: number; sealed_retention_years: number; scopes: readonly string[] };
  return { graceDays: v.grace_days, sealedRetentionYears: v.sealed_retention_years, scopes: v.scopes, version: c.version };
}

/** The first moment a pending deletion may be completed. */
export function deletionDueAt(requestedAt: Date, graceDays = retentionRules().graceDays): Date {
  return new Date(requestedAt.getTime() + graceDays * 24 * 60 * 60 * 1000);
}
