import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { ConsultationRoom, type RoomView } from "@/components/consultation/consultation-room";
import { callPolicyFor } from "@/lib/consultations/call-config";
import { ClinicianIntakePanel, type ClinicianIntake } from "@/components/consultation/clinician-intake-panel";

/**
 * S21: the clinician's consultation room. Only the clinician the consultation is assigned to is answered (INV-12);
 * anyone else gets the same 404 as an unknown id. The chart itself is not read here: notes and prescribing stay on the
 * existing consultation screen (linked below), whose reads already go through the audited path (INV-10).
 */
export default async function ClinicianConsultationPage({ params }: { params: Promise<{ encounterId: string }> }) {
  const { encounterId } = await params;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();
  const { data } = await supabase.rpc("consultation_room_view" as never, { p_encounter: encounterId } as never);
  const view = data as unknown as (RoomView & { video_consultation_id: string | null }) | null;
  if (!view || view.role !== "clinician") notFound();
  // S64 (15.3): what the patient chose to send before the visit. Audited on the database side; null when nothing was sent.
  // A failed read is shown as an error, never as "nothing was sent".
  const { data: intakeData, error: intakeError } = await supabase.rpc("clinician_consultation_intake" as never, { p_encounter: encounterId } as never);
  const intake = (intakeData ?? null) as unknown as ClinicianIntake | null;
  // null unless the Meeting SDK is configured; then the room joins inside the page and falls back to the link on any failure.
  const callPolicy = callPolicyFor(view.reconnect_grace_seconds);

  return (
    <DashboardPlaceholder greeting="Consultation" roleLabel="Clinician" comingUp={[]}>
      <div className="flex items-center justify-between gap-2">
        <Link href="/clinician/consultations" className="text-sm font-medium text-brand-green hover:underline">
          ← Back to consultations
        </Link>
        {view.video_consultation_id && (
          <Link href={`/clinician/video-visit/${view.video_consultation_id}`} className="text-sm font-medium text-brand-green hover:underline">
            Notes, scribe and prescribing →
          </Link>
        )}
      </div>
      {intakeError ? (
        <p role="alert" className="text-sm text-red-600">We could not load what the patient sent. Refresh to try again.</p>
      ) : (
        <ClinicianIntakePanel intake={intake} locale="en" />
      )}
      <ConsultationRoom view={view} locale="en" call={callPolicy ? { policy: callPolicy } : null} />
    </DashboardPlaceholder>
  );
}
