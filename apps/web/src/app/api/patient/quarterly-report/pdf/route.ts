import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { generateQuarterlyReportData } from "@/lib/reports/generate-quarterly-report";
import { QuarterlyReportDocument } from "@/lib/reports/quarterly-report-document";
import type { HealthPassportData } from "@/lib/health-passport/get-health-passport-data";

/**
 * Streams the caller's own quarterly report as a downloadable PDF —
 * ParentCare/Family Premium's "quarterly PDF report" promise. Gated on
 * has_feature_access('quarterly_report'), same null-gated-entitlement
 * pattern as RequiresEntitlement. Renders the most recently archived
 * patient_quarterly_reports row if one exists (the frozen, quotable
 * artifact); falls back to a live render (not stored) if the scheduled
 * generation job hasn't produced one yet, so a brand-new subscriber isn't
 * stuck with a 404 while waiting for the next quarter boundary.
 */
export async function GET(): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Not signed in", { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, organisation_id, role")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id || profile.role !== "patient") {
    return new Response("Not found", { status: 404 });
  }

  const { data: hasAccess } = await supabase.rpc("has_feature_access", {
    feature: "quarterly_report",
  });
  if (!hasAccess) {
    return new Response("Not authorised", { status: 403 });
  }

  const { data: latestReport } = await supabase
    .from("patient_quarterly_reports")
    .select("snapshot")
    .eq("patient_id", user.id)
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  const data = latestReport
    ? (latestReport.snapshot as unknown as HealthPassportData)
    : (await generateQuarterlyReportData(supabase, user.id, profile.organisation_id)).data;

  const buffer = await renderToBuffer(
    QuarterlyReportDocument({ patientName: profile.full_name ?? "Patient", data })
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="quarterly-report.pdf"',
    },
  });
}
