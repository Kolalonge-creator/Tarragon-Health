import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generateAndStoreQuarterlyReport } from "@/lib/reports/generate-quarterly-report";

const QUARTERLY_REPORT_FEATURE = "quarterly_report";
const DUE_AFTER_DAYS = 85; // slightly under 90 so a daily cron run never skips a boundary

/**
 * Scheduled generation of quarterly reports for every subscriber entitled to
 * one who doesn't already have one from the last ~90 days.
 *
 * Eligibility is read from the plan's own features[] rather than a hardcoded
 * list of plan codes. The old list named Family Premium, Diaspora Premium and
 * ParentCare — all three deleted by removals 3 and 4 — so a code-prefix check
 * would now match nothing and the cron would quietly do nothing forever. The
 * feature key is the thing that actually grants the report, and reading it
 * directly means a future plan carrying it is picked up with no code change.
 *
 * One report per subscriber: with individual enrolment there is no plan
 * membership to fan out to. Someone who looks after another person's record
 * sees that person's own report through patient_quarterly_reports' SELECT
 * policy, which admits a profile_access grantee.
 *
 * Invoked by Vercel Cron (see apps/web/vercel.json) — Vercel calls cron routes
 * with GET and, when a `CRON_SECRET` project env var is set, automatically
 * attaches `Authorization: Bearer <CRON_SECRET>` to the request; this route
 * verifies that header rather than a bespoke one. Uses the service-role client
 * since patient_quarterly_reports' INSERT policy is service-role-only (see
 * 20260716161000 migration).
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: subscriptions } = await supabase
    .from("subscriptions")
    .select(
      "subscriber_id, organisation_id, plan:subscription_plans!subscriptions_plan_id_fkey!inner(features)"
    )
    .in("status", ["active", "trialing"]);

  const patientOrgPairs = new Map<string, string>();
  for (const sub of subscriptions ?? []) {
    if (sub.subscriber_id === null) continue;
    if (!(sub.plan.features ?? []).includes(QUARTERLY_REPORT_FEATURE)) continue;
    patientOrgPairs.set(sub.subscriber_id, sub.organisation_id);
  }

  const dueBefore = new Date();
  dueBefore.setDate(dueBefore.getDate() - DUE_AFTER_DAYS);
  const dueBeforeIso = dueBefore.toISOString().slice(0, 10);

  let generated = 0;
  let failed = 0;
  for (const [patientId, organisationId] of patientOrgPairs) {
    const { data: lastReport } = await supabase
      .from("patient_quarterly_reports")
      .select("period_end")
      .eq("patient_id", patientId)
      .order("period_end", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastReport && lastReport.period_end > dueBeforeIso) continue;

    try {
      await generateAndStoreQuarterlyReport(supabase, patientId, organisationId);
      generated += 1;
    } catch {
      failed += 1;
    }
  }

  return Response.json({ generated, failed, evaluated: patientOrgPairs.size });
}
