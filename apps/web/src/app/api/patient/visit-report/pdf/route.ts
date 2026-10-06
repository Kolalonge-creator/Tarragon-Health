import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { parsePeriodDays, summariseReadings } from "@/lib/visit-report/summarise";
import { VisitReportDocument } from "@/lib/visit-report/visit-report-document";

/**
 * "Report for your visit": the signed-in patient's own logged readings over
 * the last 7/30/90 days as a one-page PDF. Read through the caller's own
 * RLS-scoped session and filtered to their own id, so there is no way to ask
 * for someone else's readings. Plain statistics only, see lib/visit-report.
 *
 * ?days=7|30|90 (anything else is 30)
 */
export async function GET(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const days = parsePeriodDays(new URL(request.url).searchParams.get("days"));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "patient") return new Response("Not found", { status: 404 });

  const { data: readings, error } = await supabase
    .from("vitals_readings")
    .select(
      "vital_type, taken_at, systolic, diastolic, pulse_bpm, glucose_mmol_l, glucose_context, weight_kg, validation_status, source",
    )
    .eq("patient_id", user.id)
    .gte("taken_at", since)
    .order("taken_at", { ascending: true })
    .limit(5000);
  if (error) return new Response("Could not load readings", { status: 500 });

  const summary = summariseReadings(readings ?? [], days);
  const buffer = await renderToBuffer(
    VisitReportDocument({
      data: {
        patientName: profile.full_name ?? "Patient",
        generatedAt: new Date().toISOString(),
        summary,
      },
    }),
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="tarragon-visit-report-${days}d.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
