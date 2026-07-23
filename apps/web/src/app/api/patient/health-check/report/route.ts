import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getHealthPassportData } from "@/lib/health-passport/get-health-passport-data";
import { HealthPassportDocument } from "@/lib/health-passport/health-passport-document";

/**
 * The Annual Health Check "Smart Report" — a branded, take-anywhere PDF of
 * the patient's record (the Apollo/Tata-1mg consumer-report pattern). Same
 * verified read-side data and layout as the Health Passport (thin
 * title-override wrapper, exactly like QuarterlyReportDocument) — no new
 * data surface, no claims beyond what the in-app views already show.
 * Cookie-session auth; every query scoped to the caller's own patient_id.
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

  const data = await getHealthPassportData(supabase, user.id, profile.organisation_id);
  const buffer = await renderToBuffer(
    HealthPassportDocument({
      patientName: profile.full_name ?? "Patient",
      data,
      documentTitle: "Annual Health Check Report",
    })
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="annual-health-check-report.pdf"',
    },
  });
}
