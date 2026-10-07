import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildHealthReportDraft } from "@/lib/health-report/build";
import { createAiSummaryDrafter } from "@/lib/health-report/ai-summary";

/**
 * Yearly Health Report build (S46, the spec's "health-report-build"). NOT scheduled in vercel.json: yearly generation stays behind its go-live guard
 * (`health_report_generation_enabled`, off) and the writer refuses while the guard is off, so even a call to this route builds nothing until the CMO switches
 * the guard on. Verifies the CRON_SECRET bearer like the other cron routes.
 *
 * Builds drafts for up to 25 active patients per call who have no report for the chosen year yet and some data to report on (a released lab result or a blood
 * pressure reading that year; chosen by public.health_report_candidates). Each draft goes to the clinician sign-off queue; nothing is visible to a patient until a doctor signs.
 */
export async function GET(request: Request): Promise<Response> {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }
  const url = new URL(request.url);
  const now = new Date();
  const defaultYear = now.getUTCMonth() < 2 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const year = Number(url.searchParams.get("year") ?? defaultYear);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return new Response("Bad year", { status: 400 });

  const service = createServiceRoleClient();
  const { data: candidates } = await service.rpc("health_report_candidates", { p_year: year, p_limit: 25 });
  const todo = (candidates ?? []).map((c) => c.patient_id);

  const drafter = createAiSummaryDrafter(service);
  let created = 0;
  const refused: Record<string, number> = {};
  for (const patientId of todo) {
    const out = await buildHealthReportDraft(service, { patientId, year, draftSummary: drafter });
    if (out.status === "created") created += 1;
    else {
      refused[out.reason] = (refused[out.reason] ?? 0) + 1;
      if (out.reason === "guard_off" || out.reason === "settings_unsigned") break; // the guard is global: stop at the first refusal
    }
  }
  return Response.json({ year, considered: todo.length, created, refused });
}
