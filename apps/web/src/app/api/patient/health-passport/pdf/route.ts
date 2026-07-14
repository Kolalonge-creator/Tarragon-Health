import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getHealthPassportData } from "@/lib/health-passport/get-health-passport-data";
import { HealthPassportDocument } from "@/lib/health-passport/health-passport-document";

/**
 * Streams the same read-side Health Passport data as the in-app view
 * (/patient/health-passport) as a downloadable PDF — FEATURE_SPEC.md's
 * free-tier "downloadable Health Passport PDF". Cookie-session auth (this
 * is a browser link, not a mobile bearer-token call), and every query is
 * already scoped to the caller's own patient_id — no data beyond what the
 * in-app page itself would show.
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
    HealthPassportDocument({ patientName: profile.full_name ?? "Patient", data })
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="health-passport.pdf"',
    },
  });
}
