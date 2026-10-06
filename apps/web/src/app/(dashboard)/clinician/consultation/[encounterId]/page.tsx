import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { ConsultationRoom, type RoomView } from "@/components/consultation/consultation-room";

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

  return (
    <DashboardPlaceholder greeting="Consultation" roleLabel="Clinician" comingUp={[]}>
      <div className="flex items-center justify-between gap-2">
        <Link href="/clinician/consultations" className="text-sm font-medium text-brand-green hover:underline">
          ← Back to consultations
        </Link>
        {view.video_consultation_id && (
          <Link href={`/clinician/video-visit/${view.video_consultation_id}`} className="text-sm font-medium text-brand-green hover:underline">
            Notes and prescribing →
          </Link>
        )}
      </div>
      <ConsultationRoom view={view} locale="en" />
    </DashboardPlaceholder>
  );
}
