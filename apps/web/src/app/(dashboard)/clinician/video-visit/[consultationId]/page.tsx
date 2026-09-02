import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPrescribingAuthority, isClinicalTier } from "@/lib/clinical/doctor-tier";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { ConsultationScreen } from "./consultation-screen";

export default async function ClinicianVideoVisitPage({
  params,
}: {
  params: Promise<{ consultationId: string }>;
}) {
  const { consultationId } = await params;
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  // RLS (video_consultations_select: patient_id = self OR org staff) already
  // scopes this — the 404 here is just a friendlier response than a blank
  // page for a consultation outside the caller's org.
  const supabase = await createClient();
  const { data: consult } = await supabase
    .from("video_consultations")
    .select("id, patient_id, organisation_id")
    .eq("id", consultationId)
    .maybeSingle();
  if (!consult) {
    notFound();
  }

  const { data: patient } = await supabase
    .from("profiles")
    .select("id, full_name, patient_number")
    .eq("id", consult.patient_id)
    .maybeSingle();

  const callerStaff = await getCurrentClinicalStaff();

  return (
    <DashboardPlaceholder greeting="Video consultation" roleLabel="Clinician" comingUp={[]}>
      <div className="flex items-center justify-between gap-2">
        <Link href="/clinician/appointments" className="text-sm font-medium text-brand-green hover:underline">
          ← Back to appointments
        </Link>
        {patient && (
          <Link
            href={`/clinician/patients/${patient.id}`}
            className="text-sm font-medium text-brand-green hover:underline"
          >
            Open full patient chart →
          </Link>
        )}
      </div>
      <ConsultationScreen
        consultationId={consult.id}
        organisationId={consult.organisation_id}
        patientId={consult.patient_id}
        patientName={patient?.full_name ?? "Patient"}
        patientNumber={patient?.patient_number ?? null}
        isOrgStaff={Boolean(callerStaff)}
        canWriteNotes={isClinicalTier(callerStaff)}
        canPrescribe={hasPrescribingAuthority(callerStaff)}
      />
    </DashboardPlaceholder>
  );
}
