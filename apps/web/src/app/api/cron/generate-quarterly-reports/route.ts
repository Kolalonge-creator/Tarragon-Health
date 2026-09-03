import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generateAndStoreQuarterlyReport } from "@/lib/reports/generate-quarterly-report";

const DUE_AFTER_DAYS = 85; // slightly under 90 so a daily cron run never skips a boundary

/**
 * Scheduled generation of quarterly reports for every patient entitled to
 * one who doesn't already have one from the last ~90 days.
 *
 * Every onboarded patient is eligible: the quarterly report became free to
 * all patients when the Prevent/Essential/Complete packs were retired, so
 * there is no entitlement to read. Eligibility used to come from the
 * service_product's own features[], which would now match almost nobody.
 *
 * One report per patient: with individual enrolment there is no plan
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

  // Every onboarded patient, not only those holding a pack whose features[]
  // carried 'quarterly_report'. The report became free to all patients when
  // the packs were retired; reading eligibility off service_purchases would
  // now silently exclude almost everybody, since no active product grants it.
  const { data: patients } = await supabase
    .from("profiles")
    .select("id, organisation_id")
    .eq("role", "patient")
    .not("onboarding_completed_at", "is", null)
    .not("organisation_id", "is", null);

  const patientOrgPairs = new Map<string, string>();
  for (const patient of patients ?? []) {
    if (!patient.organisation_id) continue;
    patientOrgPairs.set(patient.id, patient.organisation_id);
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
