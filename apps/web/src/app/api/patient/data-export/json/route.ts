import { createClient } from "@/lib/supabase/server";
import { getFullPatientRecordExport } from "@/lib/data-export/get-full-patient-record";

/**
 * Downloadable structured export of the caller's own complete patient
 * record (spec §34.17/§34.18: a patient must be able to obtain a
 * structured copy of their health information, and it must not become
 * trapped in the platform if they leave). Cookie-session auth, same
 * pattern as /api/patient/health-passport/pdf; every underlying query is
 * scoped to the caller's own patient_id and additionally protected by
 * RLS (patient reads own rows), so this can never return another
 * patient's data even if patientId were somehow altered.
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
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "patient") {
    return new Response("Not found", { status: 404 });
  }

  const record = await getFullPatientRecordExport(supabase, user.id);

  return new Response(JSON.stringify(record, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="tarragon-health-record.json"',
    },
  });
}
