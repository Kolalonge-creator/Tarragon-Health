import { redirect, notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { VideoVisitWaitingRoom } from "./waiting-room";

export default async function VideoVisitWaitingRoomPage({
  params,
}: {
  params: Promise<{ consultationId: string }>;
}) {
  const { consultationId } = await params;
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  // RLS already scopes this to the caller's own consultation — the extra
  // 404 here is just a friendlier response than an empty page.
  const supabase = await createClient();
  const { data: consult } = await supabase
    .from("video_consultations")
    .select("id")
    .eq("id", consultationId)
    .maybeSingle();
  if (!consult) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Video visit"
        icon={SEMANTIC_ICON.clinicianFollowUp}
        backTo={{ href: "/patient", label: "Dashboard" }}
        description="Join from this page when it is time for your visit. Your care team will admit you to the call."
      />
      <VideoVisitWaitingRoom consultationId={consultationId} patientId={profile.id} />
    </div>
  );
}
