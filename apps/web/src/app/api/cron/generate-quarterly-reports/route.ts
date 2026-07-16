import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generateAndStoreQuarterlyReport } from "@/lib/reports/generate-quarterly-report";

const QUARTERLY_REPORT_PLAN_PREFIXES = ["family_premium", "diaspora_premium", "parentcare"];
const DUE_AFTER_DAYS = 85; // slightly under 90 so a daily cron run never skips a boundary

/**
 * Scheduled generation of quarterly reports for every Family Premium/
 * diaspora Premium/ParentCare subscriber (and the family members/parents
 * attached to their plan) who doesn't already have one from the last ~90
 * days. Invoked by Vercel Cron (see apps/web/vercel.json) — Vercel calls
 * cron routes with GET and, when a `CRON_SECRET` project env var is set,
 * automatically attaches `Authorization: Bearer <CRON_SECRET>` to the
 * request; this route verifies that header rather than a bespoke one.
 * Uses the service-role client since patient_quarterly_reports' INSERT
 * policy is service-role-only (see 20260716161000 migration).
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: subscriptions } = await supabase
    .from("subscriptions")
    .select("subscriber_id, organisation_id, plan:subscription_plans!subscriptions_plan_id_fkey!inner(code)")
    .in("status", ["active", "trialing"]);

  const eligibleSubscriberIds = (subscriptions ?? [])
    .filter((s) => QUARTERLY_REPORT_PLAN_PREFIXES.some((prefix) => s.plan.code.startsWith(prefix)))
    .filter((s): s is typeof s & { subscriber_id: string } => s.subscriber_id !== null);

  const patientOrgPairs = new Map<string, string>();
  for (const sub of eligibleSubscriberIds) {
    patientOrgPairs.set(sub.subscriber_id, sub.organisation_id);
    const { data: members } = await supabase
      .from("family_plan_members")
      .select("member_id, organisation_id")
      .eq("plan_owner_id", sub.subscriber_id);
    for (const member of members ?? []) {
      patientOrgPairs.set(member.member_id, member.organisation_id);
    }
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
