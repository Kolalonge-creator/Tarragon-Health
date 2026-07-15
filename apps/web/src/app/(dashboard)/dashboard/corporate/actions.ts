"use server";

import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loadCohortAnalytics } from "@/lib/corporate/load-cohort-analytics";
import { getContractPerformance } from "@/lib/outcomes-contracts/get-contract-performance";
import type { Json } from "@tarragon/shared";

export type GenerateOutcomeReportState = { error?: string; message?: string } | undefined;

/**
 * Published, shareable outcome reports (docs/FULL_SPECIFICATION_V4.md
 * §2.4/§8 — a BD sales asset, the same anonymised numbers already on the
 * live dashboard, just frozen for a period so they can be quoted externally
 * without drifting). Server action (not a client mutation) because
 * loadCohortAnalytics needs createMlClientFromEnv(), which only resolves
 * server-side env vars.
 */
export async function generateOutcomeReport(
  _prevState: GenerateOutcomeReportState,
  formData: FormData
): Promise<GenerateOutcomeReportState> {
  const organisationId = String(formData.get("organisation_id") ?? "");
  const periodStart = String(formData.get("period_start") ?? "");
  const periodEnd = String(formData.get("period_end") ?? "");
  if (!organisationId || !periodStart || !periodEnd) {
    return { error: "Missing required fields" };
  }
  if (periodEnd < periodStart) {
    return { error: "End date must be on or after the start date" };
  }

  const profile = await getCurrentProfile();
  if (!profile || profile.role === "patient") {
    return { error: "Not authorised" };
  }
  if (profile.role !== "admin" && profile.organisation_id !== organisationId) {
    return { error: "Not authorised for this organisation" };
  }

  const supabase = await createClient();
  const [analytics, contractPerformance] = await Promise.all([
    loadCohortAnalytics(supabase, organisationId),
    getContractPerformance(supabase, organisationId),
  ]);

  if (!analytics) {
    return { error: "Not enough workforce data yet to generate a report (or the analytics service is unavailable)." };
  }

  const { error } = await supabase.from("outcome_reports").insert({
    organisation_id: organisationId,
    period_start: periodStart,
    period_end: periodEnd,
    snapshot: { analytics, contractPerformance } as unknown as Json,
    generated_by: profile.id,
  });
  if (error) {
    return { error: error.message };
  }

  return { message: "Report generated." };
}
