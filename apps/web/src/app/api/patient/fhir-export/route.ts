import { createClient } from "@/lib/supabase/server";
import { buildFhirExportBundle } from "@/lib/fhir/export/assemble";

/**
 * Patient self-service FHIR R4 export -- "export any patient's record as
 * FHIR ... publicly promise the patient can take their record and leave."
 * Cookie-session auth exactly like the existing Health Passport PDF export
 * (api/patient/health-passport/pdf/route.ts): every underlying query is
 * scoped to the caller's own patient_id via getFhirExportData, so this can
 * never surface more than the caller's own RLS session already allows. No
 * new consent primitive is needed for a patient reading their own record.
 *
 * This is deliberately a separate route from health-passport/pdf, not
 * nested under it -- it exports the FULL record, not the Health Passport's
 * trailing-12-month summary.
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
    .select("organisation_id, role")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id || profile.role !== "patient") {
    return new Response("Not found", { status: 404 });
  }

  const bundle = await buildFhirExportBundle(supabase, user.id, profile.organisation_id);

  return new Response(JSON.stringify(bundle, null, 2), {
    headers: {
      "Content-Type": "application/fhir+json",
      "Content-Disposition": 'attachment; filename="tarragon-health-record.json"',
    },
  });
}
