import Link from "next/link";
import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { PatientSummaryView } from "@/components/clinician/patient-summary";
import { LEAD_SUMMARY_READ_REASON, patientSummarySchema } from "@/lib/clinician/queue-console";

export const metadata = { title: "Patient summary" };
export const dynamic = "force-dynamic";

/** The summary for a patient I lead. The tie is checked by the function itself, not by this page. */
export default async function LeadPatientSummaryPage({ params }: { params: Promise<{ patientId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const { patientId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(patientId)) redirect("/clinician/lead-patients");
  const supabase = loose(await createClient());
  const res = await supabase.rpc("clinician_patient_summary", { p_patient: patientId, p_reason: LEAD_SUMMARY_READ_REASON });
  const parsed = res.error ? null : patientSummarySchema.safeParse(res.data);
  return (
    <div className="space-y-4">
      <Link href="/clinician/lead-patients" className="text-sm font-medium text-brand-green underline">{t("lead.title", "en")}</Link>
      {!parsed?.success && <p role="alert" className="text-sm text-red-600">{t("summary.load_error", "en")}</p>}
      {parsed?.success && parsed.data.status === "denied" && <p role="alert" className="text-sm text-red-600">{t("summary.denied", "en")}</p>}
      {parsed?.success && parsed.data.status !== "denied" && <PatientSummaryView summary={parsed.data} />}
    </div>
  );
}
