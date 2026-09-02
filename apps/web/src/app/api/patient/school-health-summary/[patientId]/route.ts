import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { computeVaccinationStatuses } from "@/lib/rules/vaccination-status";
import {
  SchoolHealthSummaryDocument,
  type SchoolHealthSummaryData,
} from "@/lib/school-health/school-health-summary-document";
import { ageFromDateOfBirth } from "@tarragon/shared";

/**
 * The take-anywhere "school health summary" (Child Health Platform §48.12) —
 * see school-health-summary-document.tsx for why this is a printable export
 * rather than a school account, and why it is vaccination-status only.
 *
 * Cookie-session auth, every read through the caller's own RLS-scoped
 * session — profiles_select already admits a profile_access grantee (a
 * parent reading their managed child), and vaccination_records/catalog are
 * readable the same way vaccination-registry.tsx already reads them for a
 * managed dependent. A patientId the caller has no access to simply returns
 * nothing here and 404s, exactly like the referral-letter route.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ patientId: string }> }
): Promise<Response> {
  const { patientId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { data: patient } = await supabase
    .from("profiles")
    .select("full_name, date_of_birth, sex")
    .eq("id", patientId)
    .maybeSingle();
  if (!patient) return new Response("Not found", { status: 404 });

  const [{ data: catalog }, { data: records }] = await Promise.all([
    supabase.from("vaccination_catalog").select("id, code, name, recommended_age").eq("is_active", true),
    supabase
      .from("vaccination_records")
      .select("vaccination_catalog_id, dose_number, date_administered")
      .eq("profile_id", patientId),
  ]);

  const statuses = computeVaccinationStatuses(catalog ?? [], records ?? [], {
    ageYears: ageFromDateOfBirth(patient.date_of_birth),
    dateOfBirth: patient.date_of_birth,
    sex: patient.sex,
  });

  const data: SchoolHealthSummaryData = {
    patientName: patient.full_name ?? "Patient",
    dateOfBirth: patient.date_of_birth,
    sex: patient.sex,
    generatedAt: new Date().toISOString(),
    // A vaccine that doesn't apply to this child (wrong sex, aged out) has
    // nothing useful to tell a school — omitted rather than printed as
    // confusing noise.
    vaccines: statuses
      .filter((s) => s.status !== "not_applicable")
      .map((s) => ({
        name: s.name,
        status: s.status,
        dosesGiven: s.dosesGiven,
        lastDoseDate: s.lastDoseDate,
      })),
  };

  const buffer = await renderToBuffer(SchoolHealthSummaryDocument({ data }));

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="tarragon-school-health-summary.pdf"',
    },
  });
}
