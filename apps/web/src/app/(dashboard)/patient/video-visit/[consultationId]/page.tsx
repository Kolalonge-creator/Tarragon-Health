import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
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
    <DashboardPlaceholder greeting="Video visit" roleLabel="Patient" comingUp={[]}>
      <div className="flex justify-end">
        <Link href="/patient" className="text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline">
          ← Back to dashboard
        </Link>
      </div>
      <VideoVisitWaitingRoom consultationId={consultationId} patientId={profile.id} />
    </DashboardPlaceholder>
  );
}
